# Harvest Hollow (skeleton)

Minimal real-time co-op farm-sim proof of concept: solo-primary, with up to
6 players able to join the same shared farm plot as optional helpers,
rendered in Three.js and synced via a Socket.io server that owns all tile
state.

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
- Real Quaternius models for soil/crop stages (no more placeholder boxes).
- Shared wallet economy: planting deducts a seed cost (3g), harvested
  crops go to a shared inventory, and `sell` cashes out the whole
  inventory at once (6g/crop) — one wallet for the room, not per-player,
  matching the GDD's "success depends on the group" pillar.

## Running locally (multiplayer test)

Requires Node.js 18+.

```bash
npm run install:all   # installs server + client deps
npm run dev            # runs server (:4000) and client (:5173) together
```

Then open **separate browser tabs** at `http://localhost:5173` to simulate
multiple players on the same farm. Each tab is a distinct socket
connection / player slot (solo-primary, up to 6 players per room). The first tab to load generates
a room code and stamps it into the URL (`?room=xyz`) — open that same URL
in the other tabs to join the same farm instead of starting a new one.

Run server/client individually if you prefer two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

## Deployment

Live and verified end-to-end (till → plant → water → harvest → sell,
cross-player, real invite-link room):

- **Client (GitHub Pages):** https://hakd0g23.github.io/Harvest-Hollow/
- **Server (Render):** https://harvest-hollow-server.onrender.com

Open the client URL to start a new farm (it stamps a room code into the
URL), or append `?room=<code>` to join an existing one — same invite-link
model as local dev, just pointed at the deployed server instead of
`localhost:4000`.

The Render service is on the free tier and spins down after 15 minutes of
inactivity — the first request after idle can take 30-60 seconds to wake
up (you'll see a blank/loading state briefly while the client waits for
`roomState`). Server infra is defined in `render.yaml` (Render Blueprint).

## Saving

Each farm (room) is saved to `server/data/rooms/<roomCode>.json` on every
tile change and reloaded automatically the next time that room code is
requested — including after a server restart. There's no separate "save"
action: the room's owner (whoever created the farm) resumes progress just
by revisiting the same invite-link URL. `server/data/` is gitignored.

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
   room, so a group can now play by sharing a URL instead of stacking tabs
   on one machine. Capacity is 6 per room (`MAX_PLAYERS`), first-come
   first-served, the 7th connection rejected with `roomFull`.
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
5. **No player-vs-tile ownership/turn locking — kept as-is, collision
   feedback implemented.** Locking would contradict the GDD's "no
   blocking griefing" pillar, so the server still applies whatever valid
   transition arrives first (within a `COLLISION_WINDOW_MS` of 3s of
   another player's action on the same tile) and flags the rejection as
   a `collision`. The client surfaces this as a distinct toast plus a
   brief emissive pulse on the contested tile, so losing an action reads
   as "someone beat you to it" rather than a silent bug.
6. **Camera is fixed** (slight-angle top-down, no orbit controls) — kept.
   Fully legible at 6x6; only worth revisiting if the grid grows beyond
   one screenful.

## Structure

```
/server   Node.js + Socket.io authoritative server (server.js)
/client   Three.js scene + Socket.io client (index.html, main.js)
```
