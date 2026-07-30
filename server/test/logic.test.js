// Unit tests for the pure, in-memory room-mutation logic in server.js —
// action/tile lifecycle, economy, cosmetics, plot expansion, and the growth
// tick. No sockets, no network, no disk writes: `createRoom()` still reads
// from disk once (via loadRoomSave) but every room id used here is a fresh
// random string that has never been saved, so it always falls through to
// fresh defaults. Fast and hermetic by construction.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.join(__dirname, '..', 'data', 'rooms');

process.env.NODE_ENV = 'test';

import {
  createRoom,
  createTile,
  applyAction,
  applyToTile,
  getTile,
  growthTick,
  rooms,
  publicRoomState,
  expandPlotOnRoom,
  upgradeToolOnRoom,
  buyCosmeticOnRoom,
  sellOnRoom,
  nextGridTier,
  nextToolTier,
  GRID_TIERS,
  GRID_EXPAND_COST,
  TOOL_TIERS,
  TOOL_UPGRADE_COST,
  COSMETICS,
  CROP_TYPE,
  SEED_COST,
  SELL_PRICE,
  STARTING_WALLET,
  GROWTH_MS,
  WILT_MS,
} from '../server.js';

// growthTick(), when it registers a real transition (see the "growth tick"
// suite below), calls the real saveRoomSoon() as a side effect — a
// setImmediate-deferred fs.writeFile straight to disk, same as production.
// Everything else in this file is a pure in-memory mutation with no I/O.
// Sweep up whatever that produced once all tests here have finished.
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50)); // let any pending writeFile land
  const files = await fs.promises.readdir(SAVE_DIR).catch(() => []);
  await Promise.all(
    files.filter((f) => f.startsWith('test-')).map((f) => fs.promises.unlink(path.join(SAVE_DIR, f)).catch(() => {}))
  );
});

function freshRoom(overrides = {}) {
  const id = `test-${Math.random().toString(36).slice(2)}`;
  const room = createRoom(id);
  Object.assign(room, overrides);
  return room;
}

describe('tile action lifecycle', () => {
  test('till -> plant -> water -> harvest happy path', () => {
    const room = freshRoom();
    const tile = getTile(room, 0, 0);
    assert.equal(tile.stage, 'empty');

    let result = applyAction(room, { type: 'till', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(tile.stage, 'tilled');

    const walletBefore = room.wallet;
    result = applyAction(room, { type: 'plant', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(tile.stage, 'planted');
    assert.equal(room.wallet, walletBefore - SEED_COST);

    result = applyAction(room, { type: 'water', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(tile.stage, 'watered');

    // Not grown yet — harvest must be rejected until growthTick promotes it.
    result = applyAction(room, { type: 'harvest', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, false);

    tile.stage = 'grown'; // simulate growthTick having promoted it
    const invBefore = room.inventory[CROP_TYPE] ?? 0;
    result = applyAction(room, { type: 'harvest', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(tile.stage, 'tilled'); // soil stays tilled, ready to replant
    assert.equal(room.inventory[CROP_TYPE], invBefore + 1);
  });

  test('rejects out-of-order transitions', () => {
    const room = freshRoom();
    // plant before till
    let result = applyAction(room, { type: 'plant', x: 1, y: 1 }, 'p1');
    assert.equal(result.ok, false);
    // water before plant
    result = applyAction(room, { type: 'water', x: 1, y: 1 }, 'p1');
    assert.equal(result.ok, false);
    // harvest an empty tile
    result = applyAction(room, { type: 'harvest', x: 1, y: 1 }, 'p1');
    assert.equal(result.ok, false);
  });

  test('rejects actions on out-of-bounds tiles', () => {
    const room = freshRoom();
    const result = applyAction(room, { type: 'till', x: 999, y: 999 }, 'p1');
    assert.equal(result.ok, false);
    assert.match(result.message, /out of bounds/i);
  });

  test('plant is rejected when wallet cannot cover seed cost', () => {
    const room = freshRoom({ wallet: SEED_COST - 1 });
    applyAction(room, { type: 'till', x: 0, y: 0 }, 'p1');
    const result = applyAction(room, { type: 'plant', x: 0, y: 0 }, 'p1');
    assert.equal(result.ok, false);
    assert.match(result.message, /not enough gold/i);
    assert.equal(getTile(room, 0, 0).stage, 'tilled'); // unchanged on rejection
  });

  test('tool-radius upgrade applies action to the full Chebyshev neighborhood', () => {
    const room = freshRoom({ toolTier: 1 }); // 3x3
    // (2,2) on a 6x6 grid has all 8 neighbors in-bounds — till the whole
    // 3x3 block by clicking the center once.
    const result = applyAction(room, { type: 'till', x: 2, y: 2 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(result.tiles.length, 9);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        assert.equal(getTile(room, 2 + dx, 2 + dy).stage, 'tilled');
      }
    }
  });

  test('tool-radius water only advances tiles that are actually planted', () => {
    const room = freshRoom({ toolTier: 1 });
    // `till` at radius 1 also tills the 3x3 neighborhood (till only requires
    // 'empty', so every neighbor qualifies) — but `plant` here is called
    // with toolTier 0 semantics for a single tile only per spec (plant never
    // uses the radius, see RADIUS_ACTIONS), so only the center gets planted.
    applyAction(room, { type: 'till', x: 2, y: 2 }, 'p1'); // tills the full 3x3
    applyAction(room, { type: 'plant', x: 2, y: 2 }, 'p1'); // plants only (2,2)
    assert.equal(getTile(room, 1, 1).stage, 'tilled'); // sanity: neighbor tilled but not planted

    const result = applyAction(room, { type: 'water', x: 2, y: 2 }, 'p1');
    assert.equal(result.ok, true);
    assert.equal(result.tiles.length, 1); // only the center was eligible (only tile in 'planted' stage)
    assert.equal(getTile(room, 2, 2).stage, 'watered');
    assert.equal(getTile(room, 1, 1).stage, 'tilled'); // untouched by water — never left 'tilled'
  });
});

// growthTick(io) iterates the module-level `rooms` singleton (populated by
// getOrCreateRoom on socket connect in normal operation) rather than taking
// rooms as a parameter — so these tests register a fresh room directly into
// that singleton, run a real tick, and deregister it afterward so it can't
// leak state into other tests/files that also touch `rooms`.
function withRegisteredRoom(room, fn) {
  rooms.set(room.id, room);
  try {
    fn();
  } finally {
    rooms.delete(room.id);
  }
}

describe('growth tick', () => {
  test('promotes watered tiles past GROWTH_MS to grown and broadcasts the change', () => {
    const room = freshRoom();
    const tile = getTile(room, 0, 0);
    tile.stage = 'watered';
    tile.wateredAt = Date.now() - GROWTH_MS - 1;
    let emitted = null;
    const fakeIo = { to: (roomId) => ({ emit: (event, payload) => { if (roomId === room.id) emitted = { event, payload }; } }) };

    withRegisteredRoom(room, () => growthTick(fakeIo));

    assert.equal(tile.stage, 'grown');
    assert.ok(emitted, 'expected tilesUpdated to be broadcast');
    assert.equal(emitted.event, 'tilesUpdated');
    assert.equal(emitted.payload[0].x, 0);
    assert.equal(emitted.payload[0].y, 0);
  });

  test('wilts unwatered planted tiles past WILT_MS back to tilled, losing the seed', () => {
    const room = freshRoom();
    const tile = getTile(room, 0, 0);
    applyAction(room, { type: 'till', x: 0, y: 0 }, 'p1');
    applyAction(room, { type: 'plant', x: 0, y: 0 }, 'p1');
    tile.plantedAt = Date.now() - WILT_MS - 1;
    const fakeIo = { to: () => ({ emit: () => {} }) };

    withRegisteredRoom(room, () => growthTick(fakeIo));

    assert.equal(tile.stage, 'tilled');
    assert.equal(tile.plantedAt, null);
  });

  test('leaves tiles under their timer threshold untouched', () => {
    const room = freshRoom();
    const tile = getTile(room, 0, 0);
    tile.stage = 'watered';
    tile.wateredAt = Date.now(); // just started, nowhere near GROWTH_MS
    const fakeIo = { to: () => ({ emit: () => { throw new Error('should not emit'); } }) };

    withRegisteredRoom(room, () => growthTick(fakeIo));

    assert.equal(tile.stage, 'watered');
  });
});

describe('economy: sell', () => {
  test('sells full inventory at SELL_PRICE and zeroes it', () => {
    const room = freshRoom({ inventory: { [CROP_TYPE]: 3 }, wallet: 0 });
    const result = sellOnRoom(room);
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
    assert.equal(result.earned, 3 * SELL_PRICE);
    assert.equal(room.wallet, 3 * SELL_PRICE);
    assert.equal(room.inventory[CROP_TYPE], 0);
  });

  test('rejects selling an empty inventory', () => {
    const room = freshRoom({ inventory: { [CROP_TYPE]: 0 } });
    const result = sellOnRoom(room);
    assert.equal(result.ok, false);
    assert.match(result.message, /nothing to sell/i);
  });
});

describe('progression: upgradeTool', () => {
  test('upgrades tier when affordable and deducts cost', () => {
    const room = freshRoom({ toolTier: 0, wallet: TOOL_UPGRADE_COST[0] });
    const result = upgradeToolOnRoom(room);
    assert.equal(result.ok, true);
    assert.equal(room.toolTier, 1);
    assert.equal(room.wallet, 0);
  });

  test('rejects when wallet cannot cover the upgrade', () => {
    const room = freshRoom({ toolTier: 0, wallet: TOOL_UPGRADE_COST[0] - 1 });
    const result = upgradeToolOnRoom(room);
    assert.equal(result.ok, false);
    assert.equal(room.toolTier, 0); // unchanged
  });

  test('rejects upgrading past the max tier', () => {
    const room = freshRoom({ toolTier: TOOL_TIERS[TOOL_TIERS.length - 1], wallet: 999_999 });
    const result = upgradeToolOnRoom(room);
    assert.equal(result.ok, false);
    assert.match(result.message, /max tier/i);
  });
});

describe('progression: expandPlot re-keying', () => {
  test('grows the grid and re-keys existing tile + player positions', () => {
    const room = freshRoom({ gridSize: 6, wallet: GRID_EXPAND_COST[6] });
    room.players.set('p1', { id: 'p1', name: 'Farmer 1', x: 2, y: 3 });
    // Mark a known tile so we can verify it survives the re-key with state intact.
    getTile(room, 2, 3).stage = 'tilled';

    const result = expandPlotOnRoom(room);
    assert.equal(result.ok, true);
    assert.equal(room.gridSize, 8);
    assert.equal(room.tiles.length, 64);
    assert.equal(room.wallet, 0);

    const grow = (8 - 6) / 2; // 1
    // The tile that was (2,3) on the old 6x6 grid should now live at (3,4)
    // on the new 8x8 grid, with its state preserved.
    const movedTile = getTile(room, 2 + grow, 3 + grow);
    assert.equal(movedTile.stage, 'tilled');

    // Player position re-keyed by the same offset.
    const player = room.players.get('p1');
    assert.equal(player.x, 2 + grow);
    assert.equal(player.y, 3 + grow);
  });

  test('does not re-key a player with null position (never acted yet)', () => {
    const room = freshRoom({ gridSize: 6, wallet: GRID_EXPAND_COST[6] });
    room.players.set('p2', { id: 'p2', name: 'Farmer 2', x: null, y: null });
    expandPlotOnRoom(room);
    const player = room.players.get('p2');
    assert.equal(player.x, null);
    assert.equal(player.y, null);
  });

  test('rejects expansion when wallet cannot cover the cost', () => {
    const room = freshRoom({ gridSize: 6, wallet: GRID_EXPAND_COST[6] - 1 });
    const result = expandPlotOnRoom(room);
    assert.equal(result.ok, false);
    assert.equal(room.gridSize, 6); // unchanged
  });

  test('rejects expansion past the max grid tier', () => {
    const maxSize = GRID_TIERS[GRID_TIERS.length - 1];
    const room = freshRoom({ gridSize: maxSize, wallet: 999_999 });
    const result = expandPlotOnRoom(room);
    assert.equal(result.ok, false);
    assert.match(result.message, /max size/i);
  });
});

describe('cosmetic gold sink: buyCosmetic', () => {
  const [firstId, firstItem] = Object.entries(COSMETICS)[0];

  test('rejects an unknown cosmetic id', () => {
    const room = freshRoom({ wallet: 999_999 });
    const result = buyCosmeticOnRoom(room, 'not-a-real-item');
    assert.equal(result.ok, false);
    assert.match(result.message, /unknown cosmetic/i);
  });

  test('rejects buying an already-owned cosmetic', () => {
    const room = freshRoom({ wallet: 999_999, cosmetics: { [firstId]: true } });
    const result = buyCosmeticOnRoom(room, firstId);
    assert.equal(result.ok, false);
    assert.match(result.message, /already purchased/i);
  });

  test('rejects when wallet cannot cover the cosmetic cost', () => {
    const room = freshRoom({ wallet: firstItem.cost - 1 });
    const result = buyCosmeticOnRoom(room, firstId);
    assert.equal(result.ok, false);
    assert.match(result.message, /not enough gold/i);
    assert.equal(room.cosmetics[firstId], undefined);
  });

  test('deducts gold and marks the cosmetic owned on a valid purchase', () => {
    const room = freshRoom({ wallet: firstItem.cost });
    const result = buyCosmeticOnRoom(room, firstId);
    assert.equal(result.ok, true);
    assert.equal(room.wallet, 0);
    assert.equal(room.cosmetics[firstId], true);
  });

  test('every cosmetic in the catalog can be purchased independently', () => {
    const room = freshRoom({ wallet: 999_999 });
    for (const [id, item] of Object.entries(COSMETICS)) {
      const result = buyCosmeticOnRoom(room, id);
      assert.equal(result.ok, true, `expected ${id} purchase to succeed`);
      assert.equal(room.cosmetics[id], true);
    }
  });
});

describe('room creation defaults', () => {
  test('a fresh room starts with defaults from spec', () => {
    const room = freshRoom();
    assert.equal(room.gridSize, 6);
    assert.equal(room.tiles.length, 36);
    assert.equal(room.wallet, STARTING_WALLET);
    assert.equal(room.toolTier, 0);
    assert.deepEqual(room.cosmetics, {});
  });

  test('publicRoomState exposes the cosmetic catalog and current costs', () => {
    const room = freshRoom();
    const state = publicRoomState(room);
    assert.equal(state.expandCost, GRID_EXPAND_COST[6]);
    assert.equal(state.upgradeCost, TOOL_UPGRADE_COST[0]);
    assert.deepEqual(state.cosmeticCatalog, COSMETICS);
  });
});
