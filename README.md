# Harvest Hollow (skeleton)

Minimal real-time co-op farm-sim proof of concept: 2 players join a shared
farm plot rendered in Three.js, synced via a Socket.io server that owns all
tile state.

Stack pattern reused from sibling projects in this workspace:
- **Server**: plain Node.js + Express + Socket.io, room/broadcast pattern
  like LuckyLanes' lobby gateway (kept intentionally lighter — no NestJS/
  Prisma here, this skeleton doesn't need a database or module framework yet).
- **Client**: Three.js loaded straight from a pinned CDN module (no bundler),
  fixed non-orbiting camera, same "no build step until real complexity
  demands one" approach as Cube Blast's `threeScene.js`.

## Core loop (skeleton scope)

Tile lifecycle, server-authoritative:

```
empty --till--> tilled --plant--> planted --water--> watered --(timer)--> grown --harvest--> tilled
```

- Server validates every action and is the only writer of tile state.
- Clients send `{ type, x, y }` actions and render whatever the server
  broadcasts back (`tilesUpdated` / `roomState`) — no client-side prediction
  or optimistic state yet.
- Placeholder visuals only: colored boxes for soil, simple sphere/cone
  "crop" meshes for planted/watered/grown stages. Real Quaternius models
  are a separate swap-in pass.

## Running locally (two-player test)

Requires Node.js 18+.

```bash
npm run install:all   # installs server + client deps
npm run dev            # runs server (:4000) and client (:5173) together
```

Then open **two separate browser tabs** at `http://localhost:5173` to
simulate two co-op players. Each tab is a distinct socket connection /
player slot (max 2 per room in this skeleton).

Run server/client individually if you prefer two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

No deployment (Netlify/Render) is set up yet — this is local-only for now,
matching LuckyLanes' and Cube Blast's deployed shape once this skeleton is
validated in a real two-tab session.

## Design decisions (reviewed 2026-07-30)

The skeleton's original judgment calls were reviewed against the GDD/TDD
by the game-engineer agent. Two turned out to be settled by the GDD
already (not actually open); the rest were genuine open questions and
have been resolved or flagged to the right owner:

1. **Fully shared plot, not per-player — settled, not open.** The GDD's
   "division of labor, not division of space" pillar already answers
   this. Either player can till/plant/water/harvest any tile on one
   shared 6x6 grid, by design — this is not a decision left to revisit.
2. **Invite-link room join — implemented.** The client reads `?room=xyz`
   from the URL (generating one if absent, stamped into the address bar)
   and passes it to the server as a Socket.io handshake query param. The
   server creates rooms on demand instead of hardcoding a single shared
   room, so two friends can now play by sharing a URL instead of two tabs
   on one machine. Still capacity 2 per room, first-come first-served,
   3rd connection rejected with `roomFull`.
3. **Growth timer: 75 seconds from watering to grown, with wilting.**
   Rebalanced from the original 20s test value to a real-time coordination
   number. A planted-but-unwatered tile now **wilts** (loses its seed,
   reverts to `tilled`) after 45 seconds — this is the mechanism that
   gives "division of labor" actual stakes; without it watering was just
   a formality click. (Only one crop type exists today, so there's no
   per-crop-tier staggering yet — revisit if/when multiple crops ship.)
4. **Harvest resets soil to `tilled`, not `empty` — kept as-is.** Making
   tilling a renewable/limited resource would add upkeep friction with no
   new agency, and breaks the GDD's clean till→plant→water→harvest→sell
   loop. Not revisited.
5. **No player-vs-tile ownership/turn locking — kept as-is, UX gap
   flagged to game-experience-designer.** Locking would contradict the
   GDD's "no blocking griefing" pillar, so the server still applies
   whatever valid transition arrives first. But a same-tile collision
   currently resolves silently — a player can lose an action with no
   feedback, which reads as a bug rather than a coordination beat. Routed
   to game-experience-designer for a lightweight "someone else just acted
   here" signal; not yet implemented.
6. **Camera is fixed** (slight-angle top-down, no orbit controls) — kept.
   Fully legible at 6x6; only worth revisiting if the grid grows beyond
   one screenful.

## Structure

```
/server   Node.js + Socket.io authoritative server (server.js)
/client   Three.js scene + Socket.io client (index.html, main.js)
```
