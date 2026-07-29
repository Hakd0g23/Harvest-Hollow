---
name: run-harvest-hollow
description: Launch and drive Harvest Hollow (co-op farm sim) — starts the Socket.io server + Vite client, drives two simulated players through the tile lifecycle with Playwright, and screenshots each stage. Use when asked to run, playtest, or verify Harvest Hollow works.
---

# Running Harvest Hollow

Node/Socket.io server (`:4000`) + Vite-served Three.js client (`:5173`),
no bundler on the client side. Two players share one 6x6 tile grid.

## Launch

```bash
cd "/Users/chamie/Documents/VS Code/Harvest Hollow"
npm run dev > /tmp/hh-dev.log 2>&1 &
```

Poll both ports before driving anything:

```bash
for i in $(seq 1 30); do curl -sf http://localhost:4000 >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 30); do curl -sf http://localhost:5173 >/dev/null 2>&1 && break; sleep 1; done
```

**Check for a stale leftover server first.** `lsof -ti:4000 -sTCP:LISTEN`
— if something's already listening, `curl -s http://localhost:4000`
before killing it. A prior session's server is often still alive and
perfectly fine to reuse (this project's dev server has no hot-reload
dependency on the client living in the same process). Only
`lsof -ti:4000 -sTCP:LISTEN | xargs -r kill` if you actually need a
clean-state restart.

## Drive it: Playwright, not chromium-cli

`chromium-cli` was not installed in this environment when this skill
was written. Playwright was available via `npx playwright@latest
--version` and Chromium was already cached at
`~/Library/Caches/ms-playwright` — only the npm package itself needed
installing, in a scratch dir:

```bash
cd /path/to/scratch && npm init -y >/dev/null 2>&1 && npm install playwright@1.62.0
```

Then `node your_script.js` using `require('playwright')`. If
`chromium-cli` is available in a future environment, prefer it — same
capability, no scratch install required.

### Interaction model — important, not a normal DOM app

There are no per-tile DOM elements to `click('selector')`. The grid is
one `<canvas>`; tile selection is raycast from mouse coordinates in
Three.js. The flow is:

1. Click a tool button by text: `Till` / `Plant` / `Water` / `Harvest`
   (these ARE real DOM buttons, `button:has-text("Till")` works).
2. Click a **pixel coordinate on the canvas** that lands on the tile
   you want. There is no tile-to-pixel API exposed — get real
   coordinates by taking a screenshot first and reading tile centers
   off the image. At the default 1280x720 viewport, the grid spans
   roughly x:368–910, y:110–610 (barn model occupies the top-left
   corner — avoid clicking there).
3. The client emits `socket.emit('action', {type, x, y})`; watch
   console for `[debug] emitting action ...` and `[debug] tilesUpdated`
   to confirm the round trip without relying on visual diffing alone
   (planted vs. grown crop meshes can look near-identical in a
   screenshot at this placeholder-art stage).

Growth timer from watered → grown is ~20s — actually wait for it
(`waitForTimeout(21000)` or poll), don't assume it fired.

### Prefer Playwright's real WebSocket API over console-log scraping

The first version of this skill watched for `[debug] emitting action`
and `[debug] tilesUpdated` strings in `page.on('console', ...)`. That
only works because the client currently leaves those debug logs in —
if they're ever cleaned up, the verification silently breaks. Playwright
has a real API for this that doesn't depend on app-side debug logging:

```js
page.on('websocket', ws => {
  console.log('ws opened:', ws.url());
  ws.on('framesent', f => console.log('>>', f.payload));
  ws.on('framereceived', f => console.log('<<', f.payload));
  ws.on('close', () => console.log('ws closed'));
});
```

Socket.io frames are engine.io-encoded text (e.g. `42["tilesUpdated",{...}]`),
readable without a decoder for a spot-check. To actually block on a
specific server event instead of guessing a timeout, wait for a frame
whose payload contains the event name:

```js
const wsPromise = page.waitForEvent('websocket');
// ... trigger the action that should cause a broadcast ...
const ws = await wsPromise;
await ws.waitForEvent('framereceived', f => f.payload.includes('tilesUpdated'));
```

This is the mechanism to reach for if a future check needs to be
exact (e.g. "did harvest actually broadcast before I screenshot") rather
than padded with a fixed `waitForTimeout`. `browserContext.routeWebSocket()`
also exists if a test ever needs to mock the server instead of running
it live (not needed for this project today — it has no external
dependencies worth mocking).

### Coordinate-clicking is a workaround, not a great one

Reading pixel coordinates off a screenshot works but is brittle: it
breaks on any camera-angle, grid-size, or viewport change, and the
"avoid the barn corner" caveat exists only because there's no way to
ask the scene "where is tile (x,y) on screen." The robust fix is a
small test seam in `main.js` — e.g.
`window.__hh = { actOnTile: (tool, x, y) => socket.emit('action', { type: tool, x, y }) }`
guarded by a dev-only flag — which turns every future driver script
from "screenshot, eyeball pixel coords, hope the camera didn't move"
into `page.evaluate(() => window.__hh.actOnTile('till', 1, 4))`. This
wasn't added yet because it touches game source for a testing concern;
flag it next time real test coverage (not just manual playtests) is
wanted for this project.

### Minimal driver skeleton

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext()).newPage();
  const p2 = await (await browser.newContext()).newPage();
  await p1.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p2.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await p1.waitForTimeout(1500); // let both sockets register (watch for "2/2 players")

  const x = 500, y = 480; // pick from a screenshot, not blind percentages
  await p1.click('button:has-text("Till")');
  await p1.mouse.click(x, y);
  await p1.click('button:has-text("Plant")');
  await p1.mouse.click(x, y);
  await p2.click('button:has-text("Water")');   // cross-player action on p1's tile
  await p2.mouse.click(x, y);                    // proves shared-plot sync, not just self-sync
  await p1.waitForTimeout(21000);                // growth timer
  await p1.click('button:has-text("Harvest")');
  await p1.mouse.click(x, y);

  await p1.screenshot({ path: '/tmp/hh_result.png' });
  await browser.close();
})();
```

Screenshot after every stage and read them back — don't just trust
console logs for the visual side, and don't trust screenshots alone
for the network side. Use both.

## Gotchas hit in practice

- **Header shows "connected — N/2 players"** — check this before
  driving actions; if it's stuck at 1/2, the second context didn't
  actually get a socket slot (room caps at 2, single hardcoded room
  `farm-1`).
- **No `timeout` command on stock macOS** — use polling loops with
  `sleep`, not `timeout npx ...`.
- Server is `node --watch server.js` — it restarts on file changes,
  which drops any live socket connections. Don't edit server files
  mid-playtest.
