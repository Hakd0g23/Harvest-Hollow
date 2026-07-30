// Harvest Hollow — authoritative Socket.io server.
// Skeleton scope: one shared room, one shared farm plot, server owns all
// tile state and validates every action. Clients are dumb renderers.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 4000;

// Farm saves: the room's owner (whoever created it) should be able to
// close the tab, come back later — even after a server restart — and pick
// up where they left off. Persisted as one JSON file per room, keyed by
// the same room code already in the invite-link URL, so "saveable" needs
// no new player-facing concept: revisiting the URL IS resuming the save.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.join(__dirname, 'data', 'rooms');
fs.mkdirSync(SAVE_DIR, { recursive: true });

function savePath(roomId) {
  return path.join(SAVE_DIR, `${roomId}.json`);
}

function loadRoomSave(roomId) {
  try {
    const raw = fs.readFileSync(savePath(roomId), 'utf-8');
    const saved = JSON.parse(raw);
    const result = {};
    if (Array.isArray(saved.tiles) && saved.tiles.length === GRID_SIZE * GRID_SIZE) {
      result.tiles = saved.tiles;
    }
    if (typeof saved.wallet === 'number') result.wallet = saved.wallet;
    if (saved.inventory && typeof saved.inventory === 'object') result.inventory = saved.inventory;
    return result;
  } catch {
    // no save yet, or unreadable/stale — fall through to fresh defaults
    return {};
  }
}

// Fire-and-forget write, coalesced per room so a burst of actions/growth
// ticks doesn't queue up redundant disk writes.
const pendingSaves = new Set();
function saveRoomSoon(room) {
  if (pendingSaves.has(room.id)) return;
  pendingSaves.add(room.id);
  setImmediate(() => {
    pendingSaves.delete(room.id);
    const payload = JSON.stringify({ tiles: room.tiles, wallet: room.wallet, inventory: room.inventory, savedAt: Date.now() });
    fs.writeFile(savePath(room.id), payload, (err) => {
      if (err) console.error(`[save] failed for room ${room.id}:`, err.message);
    });
  });
}

// Shared plot, per the GDD's "division of labor, not division of space"
// co-op pillar — any player can till/plant/water/harvest any tile, both
// see the same grid. Not an open question; settled by the GDD.
const DEFAULT_ROOM_ID = 'farm-1';
const MAX_PLAYERS = 6; // solo-primary; up to 6 helpers can join the same farm
const GRID_SIZE = 6;

// Growth timing: real-time co-op pressure, not idle-game pacing (per GDD's
// "who tills, who waters, who harvests" coordination pitch). 75s from
// watered to grown; a planted-but-unwatered tile wilts (loses its seed,
// reverts to tilled) after 45s so sloppy coordination has a real cost.
const GROWTH_MS = 75_000;
const WILT_MS = 45_000;
const GROWTH_TICK_MS = 1000;

// --- Economy (2026-07-30) ---
// Only one crop exists in assets today (wheat) — CROP_TYPE is a single
// constant rather than a per-tile field so multi-crop can slot in later
// (assets.json + a per-tile cropType) without touching this economy layer.
// Numbers: seed cost is charged *at plant time* (not at harvest), so the
// existing 45s wilt mechanic — previously just a time/re-till cost — now
// also carries a real gold stake. Sell price is 2x seed cost, matching the
// rough seed:produce markup Stardew Valley uses for wheat (10g seed / 25g
// crop, ~2.5x) — a starting wallet of 20g affords ~6 plantings before a
// player must sell, enough to learn the loop without instant bankruptcy,
// but not so much that a bad run (wilted crops) is inconsequential.
const CROP_TYPE = 'wheat';
const SEED_COST = 3; // gold, deducted on successful `plant`
const SELL_PRICE = 6; // gold per harvested crop, realized via `sell`
const STARTING_WALLET = 20;

// Tile lifecycle: empty -> tilled -> planted -> watered (growing) -> grown -> (harvest) -> tilled
//                                       \-> (wilts if unwatered too long) -> tilled
function createTile(x, y) {
  return {
    x,
    y,
    stage: 'empty', // empty | tilled | planted | watered | grown
    plantedAt: null, // ms timestamp when planted; drives the wilt clock
    wateredAt: null, // ms timestamp when watering started growth clock
    lastActionAt: null, // ms timestamp of the last *player-caused* stage change
    lastActionBy: null, // socket.id of whoever caused it — lets a rejection
                         // a moment later distinguish "someone else just beat
                         // you to this tile" from a genuine stale-tool error
  };
}

// How recent a tile's last player-caused change has to be for a same-tile
// rejection to read as a coordination collision rather than a plain user
// error. Generous enough to cover realistic co-op latency + a beat of
// hesitation, short enough that it never wrongly explains an actually-stale
// action away as "someone beat you to it."
const COLLISION_WINDOW_MS = 3000;

const ACTION_VERB_PAST = {
  till: 'tilled',
  plant: 'planted',
  water: 'watered',
  harvest: 'harvested',
};

function createRoom(id) {
  const save = loadRoomSave(id);
  const tiles = save.tiles ?? [];
  if (!save.tiles) {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        tiles.push(createTile(x, y));
      }
    }
  }
  return {
    id,
    players: new Map(), // socket.id -> { id, name }
    tiles,
    wallet: save.wallet ?? STARTING_WALLET,
    inventory: save.inventory ?? { [CROP_TYPE]: 0 }, // harvested-but-unsold crops
  };
}

// Multiple concurrent rooms, created on demand from a client-supplied room
// code (?room=xyz in the URL, per the GDD's invite-link join flow) instead
// of one hardcoded shared room.
const rooms = new Map();

function getOrCreateRoom(id) {
  if (!rooms.has(id)) rooms.set(id, createRoom(id));
  return rooms.get(id);
}

function getTile(room, x, y) {
  return room.tiles.find((t) => t.x === x && t.y === y);
}

function publicRoomState(room) {
  return {
    id: room.id,
    gridSize: GRID_SIZE,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()],
    tiles: room.tiles,
    wallet: room.wallet,
    inventory: room.inventory,
    sellPrice: SELL_PRICE,
    seedCost: SEED_COST,
  };
}

// Emits a rejection. When `tile` is passed, checks whether the tile was
// changed by a *different* player within COLLISION_WINDOW_MS — if so this
// reads to the rejected player as "they got there first" rather than a
// generic error, and carries enough info (x, y, other player's name) for
// the client to say so and flash the specific tile.
function tileError(room, socket, message, tile, actionType) {
  let collision = false;
  let actorName = null;
  if (tile && tile.lastActionAt && tile.lastActionBy && tile.lastActionBy !== socket.id) {
    if (Date.now() - tile.lastActionAt <= COLLISION_WINDOW_MS) {
      collision = true;
      actorName = room.players.get(tile.lastActionBy)?.name ?? 'Another farmer';
    }
  }
  socket.emit('actionRejected', {
    message,
    collision,
    actorName,
    actionType,
    verbPast: ACTION_VERB_PAST[actionType] ?? null,
    x: tile?.x,
    y: tile?.y,
  });
}

// --- Action validation (server is source of truth) ---
function applyAction(room, action, playerId) {
  const { type, x, y } = action;
  const tile = getTile(room, x, y);
  if (!tile) return { ok: false, message: 'Tile out of bounds.' };

  function reject(message) {
    return { ok: false, message, tile };
  }

  function accept(extra) {
    tile.lastActionAt = Date.now();
    tile.lastActionBy = playerId;
    return { ok: true, tile, ...extra };
  }

  switch (type) {
    case 'till':
      if (tile.stage !== 'empty') return reject('Tile is not empty.');
      tile.stage = 'tilled';
      return accept();

    case 'plant':
      if (tile.stage !== 'tilled') return reject('Tile must be tilled first.');
      // Seed cost is charged here, at plant time, not at harvest — this is
      // what gives the existing wilt mechanic a real economic stake instead
      // of just a time cost. Shared wallet: whoever plants pays for the
      // whole room's farm, by design (GDD: "one wallet — success depends on
      // both players contributing").
      if (room.wallet < SEED_COST) {
        return reject(`Not enough gold for seed (need ${SEED_COST}g, have ${room.wallet}g).`);
      }
      room.wallet -= SEED_COST;
      tile.stage = 'planted';
      tile.plantedAt = Date.now();
      return accept({ economyChanged: true });

    case 'water':
      if (tile.stage !== 'planted') return reject('Nothing to water here.');
      tile.stage = 'watered';
      tile.wateredAt = Date.now();
      return accept();

    case 'harvest':
      if (tile.stage !== 'grown') return reject('Not ready to harvest.');
      tile.stage = 'tilled'; // soil stays tilled, ready to replant
      tile.plantedAt = null;
      tile.wateredAt = null;
      // Harvest adds to a shared crop inventory rather than gold directly —
      // "Sell All" (a separate action) is the cash-out step, per the GDD's
      // literal phrasing ("a flat sell-all-for-gold action is enough").
      // This also gives harvesting its own satisfying feedback (a crop
      // counter ticking up) independent of the sell decision, and lets
      // players stockpile a few harvests before bothering to sell.
      room.inventory[CROP_TYPE] = (room.inventory[CROP_TYPE] ?? 0) + 1;
      return accept({ economyChanged: true });

    default:
      return { ok: false, message: `Unknown action type: ${type}` };
  }
}

// Growth tick: promote "watered" tiles past their timer to "grown", and
// wilt "planted" tiles that sat unwatered too long back to "tilled" (loses
// the seed) — the mechanism that gives coordination real stakes.
function growthTick(io) {
  for (const room of rooms.values()) {
    const now = Date.now();
    let changed = [];
    for (const tile of room.tiles) {
      if (tile.stage === 'watered' && tile.wateredAt && now - tile.wateredAt >= GROWTH_MS) {
        tile.stage = 'grown';
        changed.push(tile);
      } else if (tile.stage === 'planted' && tile.plantedAt && now - tile.plantedAt >= WILT_MS) {
        tile.stage = 'tilled';
        tile.plantedAt = null;
        changed.push(tile);
      }
    }
    if (changed.length) {
      io.to(room.id).emit('tilesUpdated', changed);
      saveRoomSoon(room);
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

function sanitizeRoomId(raw) {
  if (typeof raw !== 'string') return DEFAULT_ROOM_ID;
  const trimmed = raw.trim().slice(0, 32);
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : DEFAULT_ROOM_ID;
}

io.on('connection', (socket) => {
  const roomId = sanitizeRoomId(socket.handshake.query.room);
  const room = getOrCreateRoom(roomId);

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
      return tileError(room, socket, 'Malformed action.');
    }
    const result = applyAction(room, action, socket.id);
    if (!result.ok) {
      return tileError(room, socket, result.message, result.tile, action.type);
    }
    io.to(room.id).emit('tilesUpdated', [result.tile]);
    if (result.economyChanged) {
      io.to(room.id).emit('economyUpdate', { wallet: room.wallet, inventory: room.inventory });
    }
    saveRoomSoon(room);
  });

  // "Sell All" — the GDD's flat, shop-UI-less cash-out step. Converts the
  // whole shared inventory to gold at once; no per-crop selection since
  // there's nothing to choose between yet (one crop type).
  socket.on('sell', () => {
    const count = room.inventory[CROP_TYPE] ?? 0;
    if (count <= 0) {
      socket.emit('actionRejected', { message: 'Nothing to sell yet.', collision: false });
      return;
    }
    const earned = count * SELL_PRICE;
    room.inventory[CROP_TYPE] = 0;
    room.wallet += earned;
    io.to(room.id).emit('economyUpdate', { wallet: room.wallet, inventory: room.inventory, lastSale: { count, earned } });
    saveRoomSoon(room);
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
