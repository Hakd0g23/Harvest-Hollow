// Harvest Hollow — authoritative Socket.io server.
// Skeleton scope: one shared room, one shared farm plot, server owns all
// tile state and validates every action. Clients are dumb renderers.

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 4000;

// --- Design decision (flagged for user): fully-shared plot, single room ---
// This skeleton hardcodes ONE room ("farm-1") that any connecting client
// joins automatically, capacity 2. Tiles are NOT per-player — either player
// can till/plant/water/harvest any tile, and both see the same grid. If you
// want per-player plots or multiple concurrent rooms/lobby codes (like
// LuckyLanes' room-code join flow), that's a bigger change to flag before
// building further.
const ROOM_ID = 'farm-1';
const MAX_PLAYERS = 2;
const GRID_SIZE = 6;

// --- Design decision (flagged for user): growth timing ---
// Tile must be tilled, planted, then watered before it starts growing.
// GROWTH_MS is the time from "watered" to "grown", picked short (20s) so
// the loop is testable in a live session. Real balance is a design call —
// swap this constant once real growth-stage pacing is decided.
const GROWTH_MS = 20_000;
const GROWTH_TICK_MS = 1000;

// Tile lifecycle: empty -> tilled -> planted -> watered (growing) -> grown -> (harvest) -> tilled
function createTile(x, y) {
  return {
    x,
    y,
    stage: 'empty', // empty | tilled | planted | watered | grown
    wateredAt: null, // ms timestamp when watering started growth clock
  };
}

function createRoom(id) {
  const tiles = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      tiles.push(createTile(x, y));
    }
  }
  return {
    id,
    players: new Map(), // socket.id -> { id, name }
    tiles,
  };
}

const rooms = new Map();
rooms.set(ROOM_ID, createRoom(ROOM_ID));

function getTile(room, x, y) {
  return room.tiles.find((t) => t.x === x && t.y === y);
}

function publicRoomState(room) {
  return {
    id: room.id,
    gridSize: GRID_SIZE,
    players: [...room.players.values()],
    tiles: room.tiles,
  };
}

function tileError(socket, message) {
  socket.emit('actionRejected', { message });
}

// --- Action validation (server is source of truth) ---
function applyAction(room, action) {
  const { type, x, y } = action;
  const tile = getTile(room, x, y);
  if (!tile) return { ok: false, message: 'Tile out of bounds.' };

  switch (type) {
    case 'till':
      if (tile.stage !== 'empty') return { ok: false, message: 'Tile is not empty.' };
      tile.stage = 'tilled';
      return { ok: true, tile };

    case 'plant':
      if (tile.stage !== 'tilled') return { ok: false, message: 'Tile must be tilled first.' };
      tile.stage = 'planted';
      return { ok: true, tile };

    case 'water':
      if (tile.stage !== 'planted') return { ok: false, message: 'Nothing to water here.' };
      tile.stage = 'watered';
      tile.wateredAt = Date.now();
      return { ok: true, tile };

    case 'harvest':
      if (tile.stage !== 'grown') return { ok: false, message: 'Not ready to harvest.' };
      tile.stage = 'tilled'; // soil stays tilled, ready to replant (flagged design call)
      tile.wateredAt = null;
      return { ok: true, tile };

    default:
      return { ok: false, message: `Unknown action type: ${type}` };
  }
}

// Growth tick: promote any "watered" tile whose timer has elapsed to "grown".
function growthTick(io) {
  for (const room of rooms.values()) {
    const now = Date.now();
    let changed = [];
    for (const tile of room.tiles) {
      if (tile.stage === 'watered' && tile.wateredAt && now - tile.wateredAt >= GROWTH_MS) {
        tile.stage = 'grown';
        changed.push(tile);
      }
    }
    if (changed.length) {
      io.to(room.id).emit('tilesUpdated', changed);
    }
  }
}

const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  const room = rooms.get(ROOM_ID);

  if (room.players.size >= MAX_PLAYERS) {
    socket.emit('roomFull');
    socket.disconnect(true);
    return;
  }

  const player = { id: socket.id, name: `Farmer ${room.players.size + 1}` };
  room.players.set(socket.id, player);
  socket.join(room.id);

  console.log(`[join] ${player.name} (${socket.id}) -> room ${room.id} (${room.players.size}/${MAX_PLAYERS})`);

  // Send full authoritative state to the new player.
  socket.emit('roomState', publicRoomState(room));
  // Let everyone else know the roster changed.
  socket.to(room.id).emit('playerJoined', player);

  socket.on('action', (action) => {
    if (!action || typeof action.x !== 'number' || typeof action.y !== 'number') {
      return tileError(socket, 'Malformed action.');
    }
    const result = applyAction(room, action);
    if (!result.ok) {
      return tileError(socket, result.message);
    }
    io.to(room.id).emit('tilesUpdated', [result.tile]);
  });

  socket.on('disconnect', () => {
    room.players.delete(socket.id);
    io.to(room.id).emit('playerLeft', { id: socket.id });
    console.log(`[leave] ${player.name} (${socket.id}) (${room.players.size}/${MAX_PLAYERS})`);
  });
});

setInterval(() => growthTick(io), GROWTH_TICK_MS);

server.listen(PORT, () => {
  console.log(`Harvest Hollow server listening on http://localhost:${PORT}`);
});
