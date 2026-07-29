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

## Design decisions made for this skeleton (flag for review)

These were judgment calls to get something runnable; revisit before this
goes further:

1. **Fully shared plot, not per-player.** Either player can till/plant/
   water/harvest *any* tile on one shared 6x6 grid — there's no ownership
   or per-player sub-plot. If the intended design is "each player has their
   own patch," that's a bigger data-model change (tiles need an `ownerId`,
   and action validation needs to check it).
2. **Single hardcoded room, no lobby/room-code join flow.** Unlike
   LuckyLanes (which has a real room-code lobby), every client that
   connects joins the same fixed room (`farm-1`), capacity 2, first-come
   first-served. A 3rd connection is rejected with `roomFull`. If you want
   multiple concurrent farms or a join-by-code flow, say so before more
   gameplay gets built on top of the current single-room assumption.
3. **Growth timer: 20 seconds from watering to grown.** Picked short so
   the loop is testable live rather than for game-balance reasons — this
   is very likely the wrong number for the actual design and should be
   revisited (also: right now watering is required to start the growth
   clock at all; un-watered planted tiles never progress, and there's no
   "wilting"/repeat-watering mechanic yet — flag if that's wanted).
4. **Harvest resets soil to `tilled`, not `empty`.** So the tile is
   immediately ready to replant without re-tilling. If tilling should be a
   renewable/limited resource (i.e. degrade after harvest), this needs to
   change.
5. **No player-vs-tile ownership/turn locking.** Both players can act on
   the same tile in quick succession; the server just applies whatever
   valid transition arrives first (last-valid-action-wins, no conflict UI).
6. **Camera is fixed** (slight-angle top-down, no orbit controls), matching
   Cube Blast's fixed-camera convention — flag if you want player-controlled
   camera/zoom.

## Structure

```
/server   Node.js + Socket.io authoritative server (server.js)
/client   Three.js scene + Socket.io client (index.html, main.js)
```
