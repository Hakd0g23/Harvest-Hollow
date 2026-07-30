// Integration tests: boot the real Socket.io server (ephemeral port, no
// growth-tick interval — see the NODE_ENV=test guard at the bottom of
// server.js) and drive it with real socket.io-client connections. This is
// the only way to exercise the actual wiring (connection handshake, event
// broadcast, room join) rather than the pure logic those handlers delegate
// to (covered in logic.test.js).
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.join(__dirname, '..', 'data', 'rooms');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';

const { server, io, rooms } = await import('../server.js');

let port;
before(() => {
  return new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  io.close();
  await new Promise((resolve) => server.close(resolve));
  // saveRoomSoon writes real JSON files under data/rooms as a side effect of
  // exercising the socket handlers above (server.js has no test/persistence
  // toggle) — sweep up every `it-*.json` this run created so the repo's save
  // directory doesn't accumulate throwaway test rooms.
  const files = await fs.promises.readdir(SAVE_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((f) => f.startsWith('it-'))
      .map((f) => fs.promises.unlink(path.join(SAVE_DIR, f)).catch(() => {}))
  );
});

function connect(room) {
  return ioClient(`http://localhost:${port}`, {
    query: { room },
    transports: ['websocket'],
    forceNew: true,
  });
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function uniqueRoom() {
  return `it-${Math.random().toString(36).slice(2)}`;
}

describe('connection + room join', () => {
  test('rejects a malformed room code with invalidRoom and disconnects', async () => {
    const socket = ioClient(`http://localhost:${port}`, {
      query: { room: 'has a space!' },
      transports: ['websocket'],
      forceNew: true,
    });
    const payload = await waitFor(socket, 'invalidRoom');
    assert.ok(typeof payload.suggestedRoom === 'string' && payload.suggestedRoom.length > 0);
    socket.close();
  });

  test('a valid room code gets a roomState with starting defaults', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    const state = await waitFor(socket, 'roomState');
    assert.equal(state.id, roomId);
    assert.equal(state.gridSize, 6);
    assert.equal(state.wallet, 20);
    socket.close();
  });
});

describe('authoritative player position sync', () => {
  test('an accepted action broadcasts playerMoved with the acted tile coords', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    await waitFor(socket, 'roomState');

    const movedPromise = waitFor(socket, 'playerMoved');
    socket.emit('action', { type: 'till', x: 1, y: 2 });
    const moved = await movedPromise;

    assert.equal(moved.id, socket.id);
    assert.equal(moved.x, 1);
    assert.equal(moved.y, 2);
    socket.close();
  });

  test('a second player sees the first player\'s playerMoved broadcast', async () => {
    const roomId = uniqueRoom();
    const a = connect(roomId);
    await waitFor(a, 'roomState');
    const b = connect(roomId);
    await waitFor(b, 'roomState');

    const bSeesMove = waitFor(b, 'playerMoved');
    a.emit('action', { type: 'till', x: 0, y: 0 });
    const moved = await bSeesMove;

    assert.equal(moved.id, a.id);
    assert.equal(moved.x, 0);
    assert.equal(moved.y, 0);
    a.close();
    b.close();
  });

  test('a rejected action does not move the player', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    await waitFor(socket, 'roomState');

    // harvest on an empty tile is always rejected
    const rejectedPromise = waitFor(socket, 'actionRejected');
    let sawMoved = false;
    socket.once('playerMoved', () => { sawMoved = true; });
    socket.emit('action', { type: 'harvest', x: 3, y: 3 });
    await rejectedPromise;
    // give any (incorrect) playerMoved a moment to arrive before asserting
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sawMoved, false);
    socket.close();
  });
});

describe('expandPlot re-keying over the wire', () => {
  test('expanding re-syncs full roomState with the new grid size', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    await waitFor(socket, 'roomState');

    // Pre-seed the room's wallet directly so the test doesn't need to grind
    // 80 plant/sell cycles to afford the 240g expansion cost.
    const room = rooms.get(roomId);
    room.wallet = 1000;

    const resyncPromise = waitFor(socket, 'roomState');
    socket.emit('expandPlot');
    const resynced = await resyncPromise;

    assert.equal(resynced.gridSize, 8);
    assert.equal(resynced.tiles.length, 64);
    socket.close();
  });
});

describe('cosmetic gold sink over the wire', () => {
  test('buying an unknown cosmetic id is rejected', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    await waitFor(socket, 'roomState');

    const rejectedPromise = waitFor(socket, 'actionRejected');
    socket.emit('buyCosmetic', { id: 'not-a-real-item' });
    const rejected = await rejectedPromise;
    assert.match(rejected.message, /unknown cosmetic/i);
    socket.close();
  });

  test('a valid purchase deducts gold and broadcasts cosmeticsUpdated', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    const initial = await waitFor(socket, 'roomState');
    const [id, item] = Object.entries(initial.cosmeticCatalog)[0];

    const room = rooms.get(roomId);
    room.wallet = item.cost;

    const cosmeticsPromise = waitFor(socket, 'cosmeticsUpdated');
    const economyPromise = waitFor(socket, 'economyUpdate');
    socket.emit('buyCosmetic', { id });
    const [cosmeticsUpdate, economyUpdate] = await Promise.all([cosmeticsPromise, economyPromise]);

    assert.equal(cosmeticsUpdate.cosmetics[id], true);
    assert.equal(economyUpdate.wallet, 0);
    socket.close();
  });

  test('buying the same cosmetic twice rejects the second purchase', async () => {
    const roomId = uniqueRoom();
    const socket = connect(roomId);
    const initial = await waitFor(socket, 'roomState');
    const [id, item] = Object.entries(initial.cosmeticCatalog)[0];

    const room = rooms.get(roomId);
    room.wallet = item.cost * 2;

    socket.emit('buyCosmetic', { id });
    await waitFor(socket, 'cosmeticsUpdated');

    const rejectedPromise = waitFor(socket, 'actionRejected');
    socket.emit('buyCosmetic', { id });
    const rejected = await rejectedPromise;
    assert.match(rejected.message, /already purchased/i);
    socket.close();
  });
});
