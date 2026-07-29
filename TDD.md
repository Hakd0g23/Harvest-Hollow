# Harvest Hollow — Technical Design Document

## Stack
- **Client:** Three.js (top-down/angled camera, same rendering pattern as Cube Blast), plain responsive HTML/JS (no build step required to run — just open in a browser), Socket.io client. Must work across desktop and mobile browsers: responsive canvas sizing, and both mouse click and touch-tap input mapped to the same tile-action handler.
- **Server:** Node.js + Socket.io (authoritative real-time server, same pattern as LuckyLanes).
- **Assets:** Quaternius low-poly packs (glTF preferred for direct Three.js loading), stored in `/assets` with `LICENSE_NOTES.md`.
- **Deployment (post-MVP):** Netlify (client, static) + Render (Socket.io server) — matching LuckyLanes' proven deploy pattern. Not set up yet for the current local-dev skeleton.

## Architecture
```
client/          Three.js scene, tile rendering, input handling, socket client
server/          Socket.io server: room management, authoritative tile state, action validation, broadcast
assets/          Quaternius model files (glTF), organized per pack
```

## Server = Source of Truth
The server owns all farm state. Clients never mutate local state directly — they send an *intent* (e.g. `till`, `plant`, `water`, `harvest` + tile coordinates), the server validates it against current tile state, applies it, and broadcasts the resulting state diff to both clients in the room. This avoids desync between the two co-op players and prevents one client's lag/bug from corrupting the other's view.

## Data Model (server-side, per room)
```
Room {
  id: string
  players: [socketId, socketId]   // exactly 2 for v1
  wallet: number                  // shared currency
  tiles: Tile[N][N]
}

Tile {
  state: "empty" | "tilled" | "planted" | "watered" | "grown"
  cropType: string | null
  plantedAt: timestamp | null
  growthDuration: number           // ms, per crop type
}
```

## Networking Protocol (Socket.io events)
- `join-room` (client → server): join or create a room by ID.
- `room-state` (server → client): full state sync on join/reconnect.
- `tile-action` (client → server): `{ x, y, action: till|plant|water|harvest, cropType? }`.
- `state-diff` (server → clients): `{ x, y, newTileState }` broadcast after a validated action.
- `wallet-update` (server → clients): new shared wallet balance after a sell/harvest action.

Reconnect handling: server keeps room state alive for a grace period after a disconnect so a refreshed/reconnected player rejoins the same farm rather than losing progress.

## Growth Timers
Server-side `setTimeout`/interval per planted tile advances `state` from `planted` → `watered` (if watered in time) → `grown`. Timer duration is a per-crop-type constant, tunable without code changes (config object, not hardcoded per-tile).

## Rendering
Tile grid mapped to a Three.js plane grid; each tile's visual (soil color/planted mesh/grown mesh) driven directly by server tile state — client is a pure renderer of server truth, no client-side prediction needed for v1 given the low-stakes, non-twitchy gameplay.

## Testing Approach (MVP)
Manual: two browser tabs simulating two co-op players, verify actions from one tab reflect instantly in the other, verify reconnect doesn't reset farm state.

## Known Risks / Watch Items
- Socket.io room state is in-memory only for v1 — a server restart wipes all active farms. Acceptable for MVP; would need persistence (DB) before any real deployment with real users.
- No auth — anyone with the room link can join. Fine for a 2-friends MVP, not fine if this ever needs to scale beyond that.
