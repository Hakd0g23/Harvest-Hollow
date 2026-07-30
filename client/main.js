// Harvest Hollow — Three.js client (skeleton).
// Renders a shared farm plot synced from the Socket.io server; the server
// is authoritative, this file only ever renders state it receives back
// and sends *requests* (actions), never mutates tile state locally first.
//
// Reuses the "no bundler, load Three.js straight from a pinned CDN module"
// pattern from Cube Blast's src/threeScene.js, since this skeleton doesn't
// need a build step yet.

// Resolved via the <script type="importmap"> in index.html — the OBJLoader/
// MTLLoader modules under examples/jsm import Three itself via the bare
// specifier "three", which only resolves through an import map (no bundler
// here), so the map is required, not just a nicety.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { io } from 'https://cdn.socket.io/4.8.1/socket.io.esm.min.js';

// Hostname-aware server URL: localhost dev talks to the local server on
// :4000; anything else (the deployed GitHub Pages client) talks to the
// deployed Render service. No build-time env layer needed since this is a
// static, no-bundler client — the choice is made at runtime off location.
const SERVER_URL =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:4000'
    : 'https://harvest-hollow-server.onrender.com';

const TOOLS = ['till', 'plant', 'water', 'harvest'];
let activeTool = 'till';

// --- SFX ---
// Small pooled-Audio helper: each sound name gets a fixed-size ring of
// HTMLAudioElements instead of one shared element, so two rapid triggers of
// the same sound (e.g. quick-tapping harvest across several tiles) each get
// their own element and play cleanly instead of the second call cutting off
// or restarting the first (the stutter/overlap issue a single shared Audio()
// would cause). Playback is local-only by construction: playSfx() is only
// ever called from code paths that already gate on "this client caused it"
// (the local click/tap handlers and showToast(), which itself is only
// invoked for this client's own toasts) — never from a per-tick or
// every-remote-update path, so it can't spam on other players' actions.
const SFX_FILES = {
  till: 'till.ogg',
  plant: 'plant.ogg',
  water: 'water.ogg',
  harvest: 'harvest.ogg',
  sell: 'sell.ogg',
  ui_click: 'ui_click.ogg',
  toast: 'toast.ogg',
};
const SFX_POOL_SIZE = 4;
const sfxPools = new Map(); // name -> { pool: HTMLAudioElement[], index: number }
const SFX_MUTED_KEY = 'hh_sfx_muted_v1';
let sfxMuted = localStorage.getItem(SFX_MUTED_KEY) === '1';

function getSfxPool(name) {
  if (!sfxPools.has(name)) {
    const pool = [];
    for (let i = 0; i < SFX_POOL_SIZE; i++) {
      const audio = new Audio(`./assets/sfx/${SFX_FILES[name]}`);
      audio.preload = 'auto';
      audio.volume = 0.55;
      pool.push(audio);
    }
    sfxPools.set(name, { pool, index: 0 });
  }
  return sfxPools.get(name);
}

function playSfx(name) {
  if (sfxMuted || !SFX_FILES[name]) return;
  const entry = getSfxPool(name);
  const audio = entry.pool[entry.index];
  entry.index = (entry.index + 1) % entry.pool.length;
  try {
    audio.currentTime = 0;
    // Browsers reject play() before any user gesture on the page — by the
    // time any of these fire the player has already clicked/tapped
    // something, but swallow the rejection defensively rather than let an
    // unhandled promise rejection show up as a spurious console error.
    audio.play().catch(() => {});
  } catch {
    // no-op — a synchronous throw here would only be a very old/broken
    // browser's Audio implementation, not worth surfacing to the player.
  }
}

const statusEl = document.getElementById('status');
const economyEl = document.getElementById('economy');
const sellBtn = document.getElementById('sell-btn');
const expandBtn = document.getElementById('expand-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
const cosmeticBtns = document.querySelectorAll('.cosmetic-btn'); // fenceStyle/well/windmill buy buttons
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(message, variant = 'error') {
  toastEl.textContent = message;
  toastEl.classList.toggle('toast--collision', variant === 'collision');
  toastEl.classList.toggle('toast--success', variant === 'success');
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.display = 'none'), 2000);
  playSfx('toast');
}

function renderEconomy(wallet, inventory) {
  const wheat = inventory?.wheat ?? 0;
  economyEl.textContent = `Gold: ${wallet} | Wheat: ${wheat}`;
}

sellBtn.addEventListener('click', () => {
  playSfx('sell');
  socket.emit('sell');
});
expandBtn.addEventListener('click', () => {
  playSfx('ui_click');
  socket.emit('expandPlot');
});
upgradeBtn.addEventListener('click', () => {
  playSfx('ui_click');
  socket.emit('upgradeTool');
});
cosmeticBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('owned')) return; // already purchased — nothing to buy
    playSfx('ui_click');
    socket.emit('buyCosmetic', { id: btn.dataset.cosmetic });
  });
});

// --- Mute toggle: simple localStorage-backed hook next to the help button ---
const muteBtn = document.getElementById('mute-btn');
function updateMuteButton() {
  if (!muteBtn) return;
  muteBtn.textContent = sfxMuted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', sfxMuted ? 'Unmute sound' : 'Mute sound');
}
if (muteBtn) {
  updateMuteButton();
  muteBtn.addEventListener('click', () => {
    sfxMuted = !sfxMuted;
    localStorage.setItem(SFX_MUTED_KEY, sfxMuted ? '1' : '0');
    updateMuteButton();
  });
}

// --- Onboarding: one-time first-visit primer + reachable-anytime help ---
// Kept to a single dismissible card (no build step, no bundler here) rather
// than a multi-step wizard — real teaching happens in-world via the tool
// buttons and the pulsing hint ring on an empty tile (see markFirstHintTile
// below), following "prime, then let the mechanic teach itself" over an
// info-dump. Seen-state lives in localStorage so it survives refresh but is
// per-browser, not per-account (there are no accounts).
const ONBOARDING_SEEN_KEY = 'hh_onboarding_seen_v1';
const onboardingOverlay = document.getElementById('onboarding-overlay');
const inviteBtn = document.getElementById('invite-btn');
const helpBtn = document.getElementById('help-btn');
const onboardCopyLinkBtn = document.getElementById('onboard-copy-link');
const onboardDismissBtn = document.getElementById('onboard-dismiss');

function copyInviteLink(sourceBtn) {
  const url = window.location.href;
  const done = () => showToast('Invite link copied!', 'success');
  const fail = () => showToast(`Copy this link to invite: ${url}`, 'error');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(fail);
  } else {
    fail(); // no Clipboard API (very old browser / insecure context) — surface the link via toast instead of failing silently
  }
}

function openOnboarding() {
  onboardingOverlay.classList.add('visible');
  onboardDismissBtn.focus();
}

function closeOnboarding() {
  onboardingOverlay.classList.remove('visible');
  localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  helpBtn.focus();
}

inviteBtn.addEventListener('click', () => {
  playSfx('ui_click');
  copyInviteLink(inviteBtn);
});
onboardCopyLinkBtn.addEventListener('click', () => {
  playSfx('ui_click');
  copyInviteLink(onboardCopyLinkBtn);
});
helpBtn.addEventListener('click', () => {
  playSfx('ui_click');
  openOnboarding();
});
onboardDismissBtn.addEventListener('click', () => {
  playSfx('ui_click');
  closeOnboarding();
});
onboardingOverlay.addEventListener('click', (e) => {
  if (e.target === onboardingOverlay) closeOnboarding(); // click-outside-card dismisses, same as Escape
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && onboardingOverlay.classList.contains('visible')) closeOnboarding();
});

// Progression buy buttons: hidden entirely at max tier (nothing left to
// buy), otherwise show "Label (cost g)" and disabled if the wallet can't
// afford it yet — gates the buy without needing a separate error round-trip
// for the common "not enough gold yet" case.
function renderExpandButton(gridSize, expandCost, wallet) {
  if (expandCost == null) {
    expandBtn.style.display = 'none';
    return;
  }
  expandBtn.style.display = '';
  expandBtn.textContent = `Expand Plot (${expandCost}g)`;
  expandBtn.disabled = wallet < expandCost;
}

function renderUpgradeButton(toolTier, upgradeCost, wallet) {
  if (upgradeCost == null) {
    upgradeBtn.style.display = 'none';
    return;
  }
  upgradeBtn.style.display = '';
  upgradeBtn.textContent = `Upgrade Tool (${upgradeCost}g)`;
  upgradeBtn.disabled = wallet < upgradeCost;
}

// Cosmetic buy buttons: purely visual gold sink, no gameplay gate. Each
// button flips to a disabled "Owned" state once purchased and stays that
// way — unlike expand/upgrade there's no "max tier" concept, each item is
// independently one-and-done. Hidden until the server's cosmeticCatalog
// arrives (first roomState) so cost isn't shown as "undefinedg" pre-load.
function renderCosmeticButtons(catalog, cosmetics, wallet) {
  if (!catalog) return;
  cosmeticBtns.forEach((btn) => {
    const id = btn.dataset.cosmetic;
    const item = catalog[id];
    if (!item) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    const owned = !!cosmetics?.[id];
    btn.classList.toggle('owned', owned);
    btn.disabled = owned || wallet < item.cost;
    btn.textContent = owned ? `${item.label} ✓` : `${item.label} (${item.cost}g)`;
  });
}

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!btn.dataset.tool) return; // this handler only owns the till/plant/water/harvest selector row
    playSfx('ui_click');
    activeTool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

// --- Three.js scene setup ---
// Top-down-ish orthographic camera with a slight tilt, matching the
// "top-down or slight angle" ask and Cube Blast's fixed (non-orbiting)
// camera convention — no user camera controls in this skeleton.
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14170f);

const GRID_SIZE_FALLBACK = 6; // overwritten once roomState arrives
const TILE_SIZE = 1;
const TILE_GAP = 0.08;

let gridSize = GRID_SIZE_FALLBACK;

function frustumHalfExtent() {
  // Margin beyond the grid's own extent, so camera-framed dressing (barn,
  // fence line) clears the grid instead of clipping into it. Was a flat +1,
  // which was tight enough that the corner-decoration barn either had to
  // sit close enough to overlap tile (0,0) or fall outside the frustum
  // entirely once pushed clear of the grid — this camera is tilted, and the
  // tilt eats into vertical headroom faster than horizontal, so the margin
  // needs to be generous enough to cover that, not just "the grid + a bit".
  return (gridSize * (TILE_SIZE + TILE_GAP)) / 2 + 3.2;
}

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
function layoutCamera() {
  const half = frustumHalfExtent();
  const aspect = wrap.clientWidth / wrap.clientHeight;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}
// Angled top-down: steep enough to still read the whole grid at a glance,
// but tilted further toward horizontal than a pure overhead shot so avatars
// (and crops) show more of their profile instead of just a top-down silhouette.
camera.position.set(0, 10, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  layoutCamera();
}
window.addEventListener('resize', resize);
// The HUD is normal-flow above #canvas-wrap and can change height without a
// window resize event (e.g. expand/upgrade buttons toggling visibility, or
// the toolbar wrapping to a different number of rows) — a ResizeObserver on
// the wrap itself catches those and keeps the renderer/camera in sync with
// however much space is actually left below the HUD.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => resize()).observe(wrap);
}

// Fixed noon-time lighting — no day/night cycle. The cycle (moving sun,
// moonlight, lanterns) made assets read as flat black/blank at low
// dayFactor since most of the loop sat well under full brightness; a
// static, always-bright setup sidesteps that entirely instead of just
// tuning the low end again.
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x223311, 1.6);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 20, 8);
scene.add(sun);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
scene.background = new THREE.Color(0x8fc3e8);

// --- Tile stage -> appearance ---
const STAGE_COLOR = {
  empty: 0x4d4030,
  tilled: 0x6b4a2b,
  planted: 0x6b4a2b, // soil looks the same as tilled; the crop mesh signals state
  watered: 0x3f2e1a, // darker = moist soil
  grown: 0x6b4a2b,
};

// --- Real asset loading (Quaternius OBJ+MTL via assets.json manifest) ---
// The client never hardcodes a model path — it looks up a logical name
// ("wheat_grown", "barn", ...) through assets.json, so swapping in different
// files (or per-cropType variants later) doesn't require touching this file.
const ASSETS_BASE = './assets/';
let assetManifest = {};

const manifestPromise = (async () => {
  const res = await fetch(`${ASSETS_BASE}assets.json`);
  if (!res.ok) throw new Error(`Failed to fetch assets.json: ${res.status}`);
  assetManifest = await res.json();
  return assetManifest;
})();
manifestPromise.catch((err) => console.error('[assets] failed to load assets.json manifest', err));

const modelPromiseCache = new Map(); // logical name -> Promise<THREE.Group> (template; clone before use)

// Player avatars (Quaternius Ultimate Modular Men Pack) ship as single
// self-contained .gltf files (embedded buffers/textures, no separate .mtl),
// so they route through GLTFLoader instead of the OBJ/MTL pair every other
// pack in this manifest uses — `entry.gltf` vs `entry.obj`/`entry.mtl`
// distinguishes which loader a manifest entry needs.
const gltfLoader = new GLTFLoader();

async function loadModel(name) {
  if (modelPromiseCache.has(name)) return modelPromiseCache.get(name);
  const promise = (async () => {
    await manifestPromise; // ensure assetManifest is populated before lookup
    const entry = assetManifest[name];
    if (!entry) throw new Error(`No assets.json entry for "${name}"`);

    if (entry.gltf) {
      return new Promise((resolve, reject) => {
        gltfLoader.setPath(ASSETS_BASE);
        gltfLoader.load(
          entry.gltf,
          (gltf) => resolve(gltf.scene),
          undefined,
          reject
        );
      });
    }

    return new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath(ASSETS_BASE);
      // MTLLoader resolves texture refs (map_Kd, ...) relative to its
      // resourcePath, which defaults to the same `path` used to fetch the
      // .mtl file itself (ASSETS_BASE) — NOT the .mtl's own folder. That
      // was invisible while every pack's materials were flat colors with no
      // map_Kd (farm-buildings-pack, ultimate-crops-pack), but any pack
      // referencing a texture (the Cube World packs' shared Atlas.png)
      // resolved it against the wrong folder, 404'd, and rendered pure
      // black. Pointing resourcePath at the .mtl's actual directory fixes
      // every future textured pack too, not just this one.
      const mtlDir = entry.mtl.slice(0, entry.mtl.lastIndexOf('/') + 1);
      mtlLoader.setResourcePath(ASSETS_BASE + mtlDir);
      mtlLoader.load(
        entry.mtl,
        (materials) => {
          materials.preload();
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.setPath(ASSETS_BASE);
          objLoader.load(entry.obj, resolve, undefined, reject);
        },
        undefined,
        reject
      );
    });
  })();
  modelPromiseCache.set(name, promise);
  return promise;
}

// Uniformly scales object3D so its largest bounding-box dimension equals
// targetMaxDimension, then returns the Y offset that puts its base at y=0
// (Quaternius OBJ exports aren't all pre-centered/grounded the same way).
function normalizeToSize(object3D, targetMaxDimension) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  object3D.scale.setScalar(targetMaxDimension / maxDim);
  const scaledBox = new THREE.Box3().setFromObject(object3D);
  return -scaledBox.min.y;
}

// Tile stage -> logical crop model name. Server doesn't track a per-tile
// cropType yet (flagged in TDD/server as a v2 concern), so every planted
// tile currently renders as wheat; swapping this to a per-tile cropType
// lookup later is a manifest/lookup change, not a re-load-the-model change.
const STAGE_MODEL = {
  planted: 'wheat_planted',
  watered: 'wheat_watered',
  grown: 'wheat_grown',
};
// Wheat_2/Wheat_4 are tall thin stalks (bounding box is mostly Y height,
// very little X/Z footprint) — normalizeToSize scales uniformly off the max
// dimension, so these need a noticeably larger target than a squat model
// like Wheat_Crop would, or they read as a near-invisible dot from the
// steep top-down camera angle.
const STAGE_MODEL_SIZE = {
  planted: 0.3,
  watered: 0.6,
  grown: 0.95,
};

// Mirrors server/server.js GROWTH_MS/WILT_MS. No shared module between
// client and server in this project (plain ESM served statically, no
// bundler) — these only drive the client's own countdown display, the
// server remains the sole authority on when a tile actually flips stage.
const GROWTH_MS = 75_000; // watered -> grown
const WILT_MS = 45_000; // planted -> wilts back to tilled if not watered in time

// A large flat ground plane beneath everything — without this the world
// beyond the tile grid was just the scene background color showing through,
// so the barn/fence/decor all read as floating in a flat-color void with no
// actual ground underneath them.
const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x3f6b2e })
);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.y = -0.2; // clear of the soil tiles' own -0.075 so it never z-fights
scene.add(groundMesh);

const tileGroup = new THREE.Group();
scene.add(tileGroup);

const tileMeshes = new Map(); // "x,y" -> { soilMesh, cropMesh, pendingToken }
const knownTiles = new Map(); // "x,y" -> latest tile object, for the 1s status-icon countdown tick
const tileStatusIcons = new Map(); // "x,y" -> { sprite, canvas, ctx, texture }

// Live tile results arrive over the socket the instant the server accepts
// an action — well before the avatar has actually walked there. Applying
// them immediately made the crop/soil visually change before the avatar
// arrived, which read as the action happening independent of the avatar
// rather than caused by it. Each tile carries `lastActionBy` (the acting
// player's socket id), so results are queued per-player here and only
// applied once that player's avatar actually reaches the tile (see the
// arrival check in animate()) — full roomState resyncs (initial load, grid
// expansion) are NOT gated, since those aren't "an action just happened".
const pendingTileUpdatesByPlayer = new Map(); // playerId -> Map(tileKey -> tile)

function queuePendingTile(tile) {
  const playerId = tile.lastActionBy;
  if (!playerId) {
    applyTile(tile); // no actor on record (shouldn't normally happen) — fall back to immediate
    return;
  }
  if (!pendingTileUpdatesByPlayer.has(playerId)) pendingTileUpdatesByPlayer.set(playerId, new Map());
  pendingTileUpdatesByPlayer.get(playerId).set(tileKey(tile.x, tile.y), tile);
}

function flushPendingTilesForPlayer(playerId) {
  const pending = pendingTileUpdatesByPlayer.get(playerId);
  if (!pending || pending.size === 0) return;
  pending.forEach((tile) => applyTile(tile));
  pending.clear();
}

// A billboard sprite (always faces camera, no manual per-frame rotation
// needed) drawn from a small canvas so it can show an emoji glyph plus a
// live countdown/label without loading a dedicated icon atlas.
function createStatusSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.55, 0.55, 1);
  sprite.renderOrder = 999; // always draw on top of tiles/crops, never gets hidden behind them
  return { sprite, canvas, ctx, texture };
}

function drawStatusIcon({ ctx, canvas, texture }, glyph, label, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '58px sans-serif';
  ctx.fillText(glyph, canvas.width / 2, 50);
  if (label) {
    ctx.font = 'bold 26px sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(label, canvas.width / 2, 96);
    ctx.fillStyle = color;
    ctx.fillText(label, canvas.width / 2, 96);
  }
  texture.needsUpdate = true;
}

// What the icon over a tile should show right now, or null for stages that
// don't need one (empty/tilled — nothing growing, nothing at risk).
function statusForTile(tile) {
  const now = Date.now();
  if (tile.stage === 'grown') {
    return { glyph: '✅', label: 'Ready!', color: '#8effa0' }; // checkmark
  }
  if (tile.stage === 'watered' && tile.wateredAt) {
    const remainingS = Math.max(0, Math.ceil((GROWTH_MS - (now - tile.wateredAt)) / 1000));
    return { glyph: '🌱', label: `${remainingS}s`, color: '#bfe3ff' }; // seedling
  }
  if (tile.stage === 'planted' && tile.plantedAt) {
    const remainingS = Math.max(0, Math.ceil((WILT_MS - (now - tile.plantedAt)) / 1000));
    const urgent = remainingS <= 15;
    return { glyph: '💧', label: `${remainingS}s`, color: urgent ? '#ff6b6b' : '#ffd166' }; // droplet, reddens near wilt
  }
  return null;
}

function updateTileStatusIcon(tile) {
  const key = tileKey(tile.x, tile.y);
  const status = statusForTile(tile);
  let entry = tileStatusIcons.get(key);
  if (!status) {
    if (entry) {
      scene.remove(entry.sprite);
      tileStatusIcons.delete(key);
    }
    return;
  }
  if (!entry) {
    entry = createStatusSprite();
    const [wx, wz] = worldPos(tile.x, tile.y);
    entry.sprite.position.set(wx, 0.85, wz);
    scene.add(entry.sprite);
    tileStatusIcons.set(key, entry);
  }
  drawStatusIcon(entry, status.glyph, status.label, status.color);
}

// Countdown text needs to tick down even when nothing about the tile has
// changed server-side (applyTile only runs on an actual stage/timestamp
// update) — a 1s interval is plenty for a seconds-resolution timer and
// far cheaper than redrawing every canvas every render frame.
setInterval(() => {
  knownTiles.forEach(updateTileStatusIcon);
}, 1000);

function tileKey(x, y) {
  return `${x},${y}`;
}

function worldPos(x, y) {
  const step = TILE_SIZE + TILE_GAP;
  const offset = (gridSize - 1) / 2;
  return [(x - offset) * step, (y - offset) * step];
}

function buildGrid(size) {
  tileGroup.clear();
  tileMeshes.clear();
  knownTiles.clear();
  tileStatusIcons.forEach((entry) => scene.remove(entry.sprite));
  tileStatusIcons.clear();
  pendingTileUpdatesByPlayer.clear();
  gridSize = size;
  const soilGeo = new THREE.BoxGeometry(TILE_SIZE, 0.15, TILE_SIZE);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const material = new THREE.MeshStandardMaterial({ color: STAGE_COLOR.empty });
      const soilMesh = new THREE.Mesh(soilGeo, material);
      const [wx, wz] = worldPos(x, y);
      soilMesh.position.set(wx, -0.075, wz);
      soilMesh.userData = { x, y };
      tileGroup.add(soilMesh);
      tileMeshes.set(tileKey(x, y), { soilMesh, cropMesh: null, pendingToken: null });
    }
  }
  layoutCamera();
}

function applyTile(tile) {
  const entry = tileMeshes.get(tileKey(tile.x, tile.y));
  if (!entry) return;
  entry.soilMesh.material.color.setHex(STAGE_COLOR[tile.stage] ?? STAGE_COLOR.empty);
  knownTiles.set(tileKey(tile.x, tile.y), tile);
  updateTileStatusIcon(tile);

  // A co-op partner acting on the hint tile before the local player does is
  // itself the teaching moment ("oh, that's how it works") — clear the hint
  // the same way a local click would instead of leaving a stale ring.
  if (tile.x === 0 && tile.y === 0 && tile.stage !== 'empty') clearFirstActionHint();

  if (entry.cropMesh) {
    tileGroup.remove(entry.cropMesh);
    entry.cropMesh = null;
  }

  const modelName = STAGE_MODEL[tile.stage];
  // Invalidate any in-flight load from a previous stage on this tile so a
  // slow load (e.g. "planted") can't clobber a newer one (e.g. "grown")
  // that arrived and resolved first during rapid tool clicks.
  const token = Symbol();
  entry.pendingToken = token;
  if (!modelName) return;

  loadModel(modelName)
    .then((template) => {
      if (entry.pendingToken !== token) return; // superseded
      const cropMesh = template.clone(true);
      const groundY = normalizeToSize(cropMesh, STAGE_MODEL_SIZE[tile.stage] ?? 0.4);
      const [wx, wz] = worldPos(tile.x, tile.y);
      cropMesh.position.set(wx, groundY, wz);
      tileGroup.add(cropMesh);
      entry.cropMesh = cropMesh;
    })
    .catch((err) => {
      console.error(`[assets] failed to load crop model "${modelName}"`, err);
    });
}

// Brief emissive pulse on a specific tile so a same-tile collision reads as
// "look, right there — someone already acted" instead of only a toast the
// player has to read and mentally map back to a tile. Uses emissive (not
// the base soil color) so it never fights with the real STAGE_COLOR that
// tilesUpdated just applied.
function flashTile(x, y) {
  const entry = tileMeshes.get(tileKey(x, y));
  if (!entry) return;
  const material = entry.soilMesh.material;
  material.emissive.setHex(0x3c6e96);
  material.emissiveIntensity = 0.9;
  const start = performance.now();
  const duration = 450;
  function fade(now) {
    const t = Math.min(1, (now - start) / duration);
    material.emissiveIntensity = 0.9 * (1 - t);
    if (t < 1) requestAnimationFrame(fade);
    else material.emissive.setHex(0x000000);
  }
  requestAnimationFrame(fade);
}

// --- Player avatars (Quaternius Ultimate Modular Men Pack) ---
// The server doesn't track a live per-player world position (checked
// server/server.js — players are only { id, name }, and tiles only carry
// `lastActionBy`, the socket.id of whoever last changed that tile). Rather
// than adding server-side position tracking (out of this pass's scope —
// that's a server/game-logic change, not an asset-wiring one), each
// player's avatar is placed at that player's authoritative server-tracked
// tile position (room.players[].x/y on roomState, 'playerMoved' events on
// every subsequent action) — the server owns this now; the client no
// longer infers it from `lastActionBy` tile history.
const AVATAR_MODEL_NAMES = ['player_avatar_1', 'player_avatar_2'];
const avatarGroup = new THREE.Group();
scene.add(avatarGroup);

const knownPlayerIds = new Set(); // socket.ids currently connected to this room, per roomState/playerJoined/playerLeft
const playerAvatars = new Map(); // socket.id -> { object3D, mixer, modelName }
const mixers = []; // flat list of active AnimationMixers, updated every frame
let nextAvatarModelIndex = 0;

// Every avatar's very first spawn (page load / login) starts here — top-
// middle, just past the back fence line — instead of snapping straight
// onto whatever tile the player last acted on. That first walk-in is what
// establishes "this character walks to tiles" as soon as a player arrives,
// rather than the first thing they see being a teleport. Re-derived from
// gridSize (not baked in) so it still lands just past the fence at any plot
// size.
function avatarSpawnOrigin() {
  const gridReach = gridHalfExtent();
  return [0, -(gridReach + 1.4)];
}

// Player avatars are skinned meshes (bone hierarchy + skin weights); a
// plain Object3D.clone(true) does NOT correctly rebind SkinnedMesh bones to
// their cloned skeleton (a well-known Three.js gotcha), unlike the static
// prop/crop models above which are safe to clone from a cached template.
// Since there are at most a handful of simultaneous players, loading a
// fresh GLTFLoader instance per avatar (no template-cloning) sidesteps the
// bug entirely and isn't a meaningful perf cost at this scale.
function loadFreshGltfScene(modelName) {
  return new Promise(async (resolve, reject) => {
    await manifestPromise;
    const entry = assetManifest[modelName];
    if (!entry?.gltf) return reject(new Error(`No gltf entry for "${modelName}"`));
    const loader = new GLTFLoader();
    loader.setPath(ASSETS_BASE);
    loader.load(entry.gltf, resolve, undefined, reject);
  });
}

async function spawnAvatarForPlayer(playerId) {
  if (playerAvatars.has(playerId)) return;
  const modelName = AVATAR_MODEL_NAMES[nextAvatarModelIndex % AVATAR_MODEL_NAMES.length];
  nextAvatarModelIndex += 1;
  // Reserve the slot immediately (before the async load resolves) so a fast
  // playerLeft during load doesn't race a second spawn for the same id.
  playerAvatars.set(playerId, null);
  try {
    const gltf = await loadFreshGltfScene(modelName);
    if (!playerAvatars.has(playerId)) return; // player already left mid-load
    const object3D = gltf.scene;
    // Was 0.9 — nearly as large as TILE_SIZE (1), so the avatar's footprint
    // dominated whatever tile it stood on and visually swallowed the crop
    // mesh/soil color underneath it (both share the same x,z). 0.55 keeps it
    // clearly readable top-down (it's still the tallest thing on a tile)
    // without fully occluding the tile it's standing on.
    const groundY = normalizeToSize(object3D, 0.55);
    const [originX, originZ] = avatarSpawnOrigin();
    object3D.position.set(originX, groundY, originZ); // parked at the top-middle spawn point until a tile action places it
    object3D.visible = true; // visible immediately, idling at the spawn point — no more waiting on a first click to appear

    let mixer = null;
    let idleAction = null;
    let walkAction = null;
    const idleClip = gltf.animations.find((c) => c.name === 'Idle');
    const walkClip = gltf.animations.find((c) => c.name === 'Walk');
    if (idleClip) {
      mixer = new THREE.AnimationMixer(object3D);
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
      if (walkClip) {
        walkAction = mixer.clipAction(walkClip);
        walkAction.setLoop(THREE.LoopRepeat);
      }
      mixers.push(mixer);
    }

    avatarGroup.add(object3D);
    playerAvatars.set(playerId, {
      object3D,
      mixer,
      modelName,
      idleAction,
      walkAction,
      tileKey: null, // "x,y" of the tile this avatar is currently placed on, for move detection
      isWalking: false, // driven off actual remaining travel distance in animate(), not a guessed timeout
      // Target world position for this frame's interpolation. Every
      // placement (including the very first one) now walks in from wherever
      // the avatar currently is — see avatarSpawnOrigin() for where that
      // starts on login.
      targetX: object3D.position.x,
      targetZ: object3D.position.z,
      // Counts down while idle (arrived, nothing queued); hitting zero picks
      // a fresh random roam point (see randomRoamPoint()) so idle avatars
      // wander the farm instead of standing frozen between actions.
      wanderTimer: 2 + Math.random() * 3,
    });
  } catch (err) {
    console.error(`[assets] failed to load player avatar "${modelName}"`, err);
    playerAvatars.delete(playerId);
  }
}

function removeAvatarForPlayer(playerId) {
  const avatar = playerAvatars.get(playerId);
  if (avatar?.object3D) {
    avatarGroup.remove(avatar.object3D);
    if (avatar.mixer) {
      const idx = mixers.indexOf(avatar.mixer);
      if (idx !== -1) mixers.splice(idx, 1);
    }
  }
  playerAvatars.delete(playerId);
}

// Standing an avatar dead-center on the tile it just acted on put its feet
// directly on top of the (much smaller) crop mesh / soil tint, hiding the
// exact thing the player needs to see feedback on. Nudging it toward the
// camera-facing edge of the tile keeps the avatar clearly on that tile
// (still the closest thing to it) while leaving the tile's center — where
// the crop/soil color renders — unobstructed from the top-down camera.
const AVATAR_TILE_EDGE_OFFSET = 0.32;

function placeAvatarOnTile(playerId, x, y) {
  const avatar = playerAvatars.get(playerId);
  if (!avatar?.object3D) return; // still loading, or never spawned (e.g. self before roomState)
  const key = tileKey(x, y);
  avatar.tileKey = key;
  const [wx, wz] = worldPos(x, y);
  avatar.targetX = wx;
  avatar.targetZ = wz + AVATAR_TILE_EDGE_OFFSET;
  avatar.wanderTimer = 2 + Math.random() * 3; // a real destination always takes priority over idle roaming
  avatar.object3D.visible = true;
  // Every placement — including the very first one, walking in from
  // avatarSpawnOrigin() — now interpolates in the render loop below instead
  // of snapping. The walk/idle animation crossfade is driven off actual
  // remaining distance each frame (see animate()), not fired here, so it
  // stays in sync with travel that can vary in length (a fresh login walk-in
  // is much farther than a one-tile step).
}

// --- Static scene dressing (barn + fence line), loaded once real state arrives ---
// Half-extent of the actual tile grid footprint (distinct from
// frustumHalfExtent(), which is the *camera framing* margin — using the
// frustum margin to position the barn left only ~0.6 world units of
// clearance from the frustum edge, which sits *inside* the grid's real
// footprint once tile size + the barn's own (rotated) footprint are
// accounted for. That's what let the barn's corner bleed into tile (0,0):
// at the default 6x6 grid, the barn's nearest corner landed ~3.59 units from
// origin while tile (0,0)'s footprint spans ~3.11-4.53 along that same
// diagonal — a real overlap, not just visually tight.
function gridHalfExtent() {
  const step = TILE_SIZE + TILE_GAP;
  return ((gridSize - 1) / 2) * step + TILE_SIZE / 2;
}

// A random point anywhere across the actual tile grid (not just a tiny
// nudge near wherever the avatar last stood) — used for idle ambient
// wandering so an unassigned avatar reads as walking around the farm
// rather than fidgeting in one spot.
function randomRoamPoint() {
  const reach = gridHalfExtent() - 0.4; // stay inboard of the fence/edge
  return [(Math.random() * 2 - 1) * reach, (Math.random() * 2 - 1) * reach];
}

const BARN_MAX_DIM = 2.2;

// Barn is loaded once, but its diagonal offset depends on gridSize, which
// changes at runtime (plot expansion re-emits a full 'roomState' with a
// larger gridSize — see server.js's expandPlot handler). Positioning it only
// once at load time is what let the barn overlap playable tiles again once
// the grid grew past whatever size it was framed for at load: the offset
// baked in the *old* gridReach and never got recomputed for the new one.
// Re-deriving position from the current gridSize on every call (instead of
// baking it in once) keeps the barn clear of the grid at every tier.
let barnObject = null;
function positionBarn() {
  if (!barnObject) return;
  const gridReach = gridHalfExtent(); // already the farthest tile edge per axis — don't add TILE_SIZE/2 again
  const barnHalfDiagonal = (BARN_MAX_DIM / 2) * Math.SQRT2;
  const gap = 0.2;
  const barnOffset = gridReach + barnHalfDiagonal + gap;
  barnObject.position.x = -barnOffset;
  barnObject.position.z = -barnOffset;
}

let staticPropsAdded = false;
async function addStaticProps() {
  if (staticPropsAdded) return;
  staticPropsAdded = true;
  const half = frustumHalfExtent(); // still used for the fence line's camera-framed span, below

  try {
    const barnTemplate = await loadModel('barn');
    const barn = barnTemplate.clone(true);
    const groundY = normalizeToSize(barn, BARN_MAX_DIM);
    barn.rotation.y = Math.PI / 4;
    // Barn sits on the grid's diagonal corner (x === z offset); see
    // positionBarn() above for why (x, z) are set there instead of here.
    barn.position.y = groundY;
    barnObject = barn;
    positionBarn();
    scene.add(barn);
  } catch (err) {
    console.error('[assets] failed to load barn', err);
  }

  await buildFenceLine(half);
  await buildEnvironmentDecor();
}

// --- Ambient scenery (Cube World environment props, free decoration) ---
// Unlike the barn/fence/well/windmill above, these aren't gameplay-relevant
// or purchasable — just trees/rocks/flowers/bamboo/crystals scattered along
// the grid's open side edges (the fence line already dresses the back edge)
// to make the world feel less like tiles floating in a void. Positions are
// derived from a fixed seed (mulberry32) so every client renders the same
// layout without needing server sync, and re-derived from gridSize on every
// roomState so plot expansion pushes decor outward instead of leaving it to
// clip into newly-added tiles.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DECOR_TYPES = [
  { model: 'env_tree_1', maxDim: 1.6 },
  { model: 'env_tree_2', maxDim: 1.6 },
  { model: 'env_tree_3', maxDim: 1.8 },
  { model: 'env_rock_1', maxDim: 0.6 },
  { model: 'env_rock_2', maxDim: 0.7 },
  { model: 'env_flowers_1', maxDim: 0.4 },
  { model: 'env_flowers_2', maxDim: 0.4 },
  { model: 'env_bamboo_small', maxDim: 0.8 },
  { model: 'env_bamboo_mid', maxDim: 1.1 },
  { model: 'env_crystal', maxDim: 0.9 },
];
const DECOR_PER_SIDE = 6; // per left/right edge
const DECOR_FRONT_COUNT = 4; // low-profile cluster near the camera-facing edge

// Each slot's type + jitter is picked once (seeded) and reused across
// repositionDecor() calls, so decor doesn't visually shuffle every time the
// grid resizes — only its distance from the grid changes.
const decorSlots = []; // { typeIndex, side: 'left'|'right'|'front', t (0..1 along edge), jitter }
const decorObjects = []; // parallel THREE.Object3D once loaded, or null while loading
let decorBuilt = false;

function buildDecorSlots() {
  const rand = mulberry32(20260730);
  for (let i = 0; i < DECOR_PER_SIDE; i++) {
    decorSlots.push({ typeIndex: Math.floor(rand() * DECOR_TYPES.length), side: 'left', t: (i + 0.5) / DECOR_PER_SIDE, jitter: (rand() - 0.5) * 0.5 });
    decorSlots.push({ typeIndex: Math.floor(rand() * DECOR_TYPES.length), side: 'right', t: (i + 0.5) / DECOR_PER_SIDE, jitter: (rand() - 0.5) * 0.5 });
  }
  // Front cluster is restricted to low, camera-friendly types (rocks/flowers/
  // bamboo, no trees) so it frames the grid instead of blocking it.
  const lowTypeIndices = DECOR_TYPES.reduce((acc, t, idx) => (t.maxDim <= 1.1 ? [...acc, idx] : acc), []);
  for (let i = 0; i < DECOR_FRONT_COUNT; i++) {
    decorSlots.push({
      typeIndex: lowTypeIndices[Math.floor(rand() * lowTypeIndices.length)],
      side: 'front',
      t: (i + 0.5) / DECOR_FRONT_COUNT,
      jitter: (rand() - 0.5) * 0.5,
    });
  }
}

function positionDecorObject(index) {
  const object = decorObjects[index];
  if (!object) return;
  const slot = decorSlots[index];
  const gridReach = gridHalfExtent();
  const sideGap = 0.9;
  const frontGap = 1.6; // clears the well/windmill/barn corner offsets
  const span = gridReach * 2;
  if (slot.side === 'left' || slot.side === 'right') {
    const x = (slot.side === 'left' ? -1 : 1) * (gridReach + sideGap);
    const z = -gridReach + slot.t * span + slot.jitter;
    object.position.set(x, object.position.y, z);
  } else {
    const x = -gridReach + slot.t * span + slot.jitter;
    const z = gridReach + frontGap;
    object.position.set(x, object.position.y, z);
  }
}

async function buildEnvironmentDecor() {
  if (decorBuilt) return;
  decorBuilt = true;
  buildDecorSlots();
  await Promise.all(
    decorSlots.map(async (slot, index) => {
      const type = DECOR_TYPES[slot.typeIndex];
      try {
        const template = await loadModel(type.model);
        const object = template.clone(true);
        const groundY = normalizeToSize(object, type.maxDim);
        object.rotation.y = slot.jitter * Math.PI; // cheap variety so clones of the same prop don't look identical
        object.position.y = groundY;
        decorObjects[index] = object;
        positionDecorObject(index);
        scene.add(object);
      } catch (err) {
        console.error(`[assets] failed to load decor "${type.model}"`, err);
      }
    })
  );
}

function repositionDecor() {
  decorObjects.forEach((_, index) => positionDecorObject(index));
}

// --- Cosmetic gold-sink props (purchased, purely decorative) ---
// The border fence line is built by a swappable helper (rather than being
// inlined in addStaticProps like before) so a "Painted Fence" cosmetic
// purchase can rebuild it with a different model name mid-session, without
// duplicating the placement math. `fenceLineGroup` holds every fence mesh so
// a rebuild can clear the old style before adding the new one.
const fenceLineGroup = new THREE.Group();
scene.add(fenceLineGroup);

async function buildFenceLine(half) {
  const modelName = purchasedCosmetics.fenceStyle ? 'fence_painted' : 'fence';
  try {
    const fenceTemplate = await loadModel(modelName);
    fenceLineGroup.clear();
    const spacing = 0.9;
    const fenceCount = Math.max(1, Math.ceil((half * 2) / spacing));
    for (let i = 0; i < fenceCount; i++) {
      const fence = fenceTemplate.clone(true);
      const groundY = normalizeToSize(fence, 0.85);
      fence.position.set(-half + i * spacing, groundY, -half - 0.5);
      fenceLineGroup.add(fence);
    }
  } catch (err) {
    console.error(`[assets] failed to load ${modelName}`, err);
  }
}

// Well/windmill are one-off decorative props, added once purchased, parked
// on the two grid corners the barn doesn't already occupy (barn sits on the
// -x/-z diagonal — see positionBarn) so nothing overlaps a playable tile at
// any grid tier.
const cosmeticPropObjects = {}; // id -> THREE.Object3D, once loaded
const COSMETIC_PROP_CONFIG = {
  well: { model: 'cosmetic_well', maxDim: 1.1, corner: [1, -1] }, // +x/-z corner
  windmill: { model: 'cosmetic_windmill', maxDim: 2.4, corner: [1, 1] }, // +x/+z corner
};

function positionCosmeticProp(id) {
  const object = cosmeticPropObjects[id];
  const config = COSMETIC_PROP_CONFIG[id];
  if (!object || !config) return;
  const gridReach = gridHalfExtent();
  const gap = 0.6;
  const offset = gridReach + config.maxDim / 2 + gap;
  const [signX, signZ] = config.corner;
  object.position.x = signX * offset;
  object.position.z = signZ * offset;
}

async function addCosmeticProp(id) {
  if (cosmeticPropObjects[id]) return; // already added
  const config = COSMETIC_PROP_CONFIG[id];
  if (!config) return;
  try {
    const template = await loadModel(config.model);
    const object = template.clone(true);
    const groundY = normalizeToSize(object, config.maxDim);
    object.position.y = groundY;
    cosmeticPropObjects[id] = object;
    positionCosmeticProp(id);
    scene.add(object);
  } catch (err) {
    console.error(`[assets] failed to load cosmetic "${id}"`, err);
  }
}

// Re-derives every purchased cosmetic's position — mirrors positionBarn()
// being re-run on every roomState in case gridSize changed (plot expansion)
// after a cosmetic was already placed.
function repositionCosmeticProps() {
  Object.keys(cosmeticPropObjects).forEach(positionCosmeticProp);
}

// Local cache of which cosmetics are owned, keyed the same as room.cosmetics
// (id -> true). Drives both the fence-style swap and which one-off props
// exist in the scene; updated from roomState (initial) and cosmeticsUpdated
// (live purchase by any player in the room).
let purchasedCosmetics = {};
let cosmeticCatalog = null;

function applyCosmetics(cosmetics) {
  purchasedCosmetics = cosmetics ?? {};
  buildFenceLine(frustumHalfExtent());
  Object.keys(COSMETIC_PROP_CONFIG).forEach((id) => {
    if (purchasedCosmetics[id]) addCosmeticProp(id);
  });
}

// --- Skill-gate hint: a pulsing ring over one empty tile until the player's
// first action, teaching "tap a tile" by pointing at it rather than telling
// them (Prime/Teach/Observe over dialogue). Shape + motion carry the signal
// (a bobbing torus outline), not color alone, so it's legible for colorblind
// players and still visible against any soil color. Skipped entirely once
// the player has ever acted (localStorage flag), including returning
// visitors and the second/third co-op joiner who's watching someone else's
// farm that's already past tile zero.
const FIRST_ACTION_TAKEN_KEY = 'hh_first_action_taken_v1';
let hintRing = null;
let hintRingStart = 0;

function showFirstActionHint() {
  if (localStorage.getItem(FIRST_ACTION_TAKEN_KEY)) return;
  if (hintRing || tileGroup.children.length === 0) return;
  const [wx, wz] = worldPos(0, 0);
  const geo = new THREE.TorusGeometry(0.32, 0.05, 8, 24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xf7e8b0 });
  hintRing = new THREE.Mesh(geo, mat);
  hintRing.rotation.x = -Math.PI / 2;
  hintRing.position.set(wx, 0.5, wz);
  hintRingStart = performance.now();
  scene.add(hintRing);
}

function clearFirstActionHint() {
  if (!localStorage.getItem(FIRST_ACTION_TAKEN_KEY)) {
    localStorage.setItem(FIRST_ACTION_TAKEN_KEY, '1');
  }
  if (hintRing) {
    scene.remove(hintRing);
    hintRing = null;
  }
}

// --- Raycasting / tap-to-act (mouse click and touch tap share one handler) ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Touch devices don't have hover, and browsers fire a synthetic "click"
// after touchend anyway — handling both would double-fire the action, so
// touchend does the raycast+emit directly and suppresses the trailing
// synthetic click via preventDefault.
renderer.domElement.style.touchAction = 'none';

// Clicks queue up rather than firing immediately: the local player's avatar
// walks to each clicked tile in click order, and the actual server action
// (and its SFX) only fires once the avatar physically arrives there — see
// the queue-draining logic in animate(). A tile's action never "auto
// starts" just because it was clicked; it starts when the avatar is on it.
const actionQueue = []; // { x, y, type } in click order, local player only

function actOnScreenPoint(clientX, clientY) {
  // Grid doesn't exist yet if roomState hasn't arrived (cold-start wake can
  // take 30-60s) — bail out instead of touching tileGroup.children[0].
  if (tileGroup.children.length === 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(tileGroup.children, false);
  const hit = hits.find((h) => h.object.userData && typeof h.object.userData.x === 'number');
  if (!hit) return;
  const { x, y } = hit.object.userData;
  clearFirstActionHint();
  actionQueue.push({ x, y, type: activeTool });
  // If this is the only thing queued, start walking there right away
  // (interrupting idle wandering); otherwise it just waits its turn behind
  // whatever's already queued — the avatar keeps finishing its current trip.
  if (actionQueue.length === 1 && socket.id) {
    spawnAvatarForPlayer(socket.id).then(() => placeAvatarOnTile(socket.id, x, y));
  }
}

renderer.domElement.addEventListener('click', (event) => {
  actOnScreenPoint(event.clientX, event.clientY);
});

let lastTouchStart = null;
renderer.domElement.addEventListener(
  'touchstart',
  (event) => {
    const t = event.touches[0];
    lastTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
  },
  { passive: true }
);
renderer.domElement.addEventListener('touchend', (event) => {
  event.preventDefault(); // stop the synthetic click that would double-fire the action
  const t = event.changedTouches[0];
  if (!t || !lastTouchStart) return;
  // Treat as a tap (not a drag) only if the finger didn't move much — the
  // camera is fixed/non-pannable so any touchmove handling is for future
  // gestures, not needed for this tap-only interaction.
  const dx = t.clientX - lastTouchStart.x;
  const dy = t.clientY - lastTouchStart.y;
  if (Math.hypot(dx, dy) > 12) return;
  actOnScreenPoint(t.clientX, t.clientY);
});

// --- Socket.io client ---
// Room code comes from ?room=xyz in the URL (invite-link join, per the
// GDD) — falls back to the server's default shared room if absent, and
// stamps the code into the URL so the first player can just copy the tab's
// address bar to invite a second player into the same room.
function getOrCreateRoomCode() {
  const params = new URLSearchParams(window.location.search);
  let room = params.get('room');
  if (!room) {
    room = Math.random().toString(36).slice(2, 8);
    params.set('room', room);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }
  return room;
}

const roomCode = getOrCreateRoomCode();
const socket = io(SERVER_URL, { query: { room: roomCode } });

// Test seam: exact tile actions without screenshot-and-eyeball pixel-coord
// raycasting (see run-harvest-hollow skill's "Coordinate-clicking is a
// workaround" note). Client-only, no server change, harmless in production
// (just an alternate way to fire the same 'action' emit the raycaster
// already sends) — not gated behind a build-time flag since this project
// has no bundler/env layer to gate it with.
window.__hh = {
  actOnTile: (tool, x, y) => {
    socket.emit('action', { type: tool, x, y });
    playSfx(tool);
  },
};

socket.on('connect', () => {
  statusEl.textContent = 'connected';
});
socket.on('disconnect', () => {
  statusEl.textContent = 'disconnected';
});
let maxPlayers = 6; // overwritten by roomState; fallback matches server default

socket.on('roomFull', () => {
  statusEl.textContent = `room full (max ${maxPlayers} players)`;
});

// Server rejects malformed/garbage room codes rather than silently folding
// them into the shared default room — redirect to a freshly generated valid
// code instead. A full reload is deliberate here: it re-runs getOrCreateRoomCode
// and reconnects cleanly with the new query param instead of juggling a live
// socket's connection params mid-session.
socket.on('invalidRoom', ({ suggestedRoom }) => {
  const params = new URLSearchParams(window.location.search);
  params.set('room', suggestedRoom);
  window.location.replace(`${window.location.pathname}?${params}`);
});

// Cached progression state so a wallet-only economyUpdate can still re-gate
// the buy buttons (affordability) without needing the server to resend
// gridSize/toolTier on every gold change.
let currentGridSize = GRID_SIZE_FALLBACK;
let currentExpandCost = null;
let currentToolTier = 0;
let currentUpgradeCost = null;
let currentWallet = 0;

socket.on('roomState', (room) => {
  buildGrid(room.gridSize);
  knownPlayerIds.clear();
  room.players.forEach((p) => knownPlayerIds.add(p.id));
  room.tiles.forEach(applyTile);
  // Every player gets a visible avatar immediately (parked at
  // avatarSpawnOrigin(), idling) rather than staying invisible until their
  // first action — a player with x/y still null just hasn't picked a real
  // tile yet this session, so it walks onto one the moment placeAvatarOnTile
  // is called for a real server-tracked position.
  room.players.forEach((p) => {
    spawnAvatarForPlayer(p.id).then(() => {
      if (p.x !== null && p.y !== null) placeAvatarOnTile(p.id, p.x, p.y);
    });
  });
  maxPlayers = room.maxPlayers;
  statusEl.textContent = `connected — ${room.players.length}/${maxPlayers} players`;
  renderEconomy(room.wallet, room.inventory);

  currentGridSize = room.gridSize;
  currentExpandCost = room.expandCost ?? null;
  currentToolTier = room.toolTier ?? 0;
  currentUpgradeCost = room.upgradeCost ?? null;
  currentWallet = room.wallet;
  renderExpandButton(currentGridSize, currentExpandCost, currentWallet);
  renderUpgradeButton(currentToolTier, currentUpgradeCost, currentWallet);

  cosmeticCatalog = room.cosmeticCatalog ?? cosmeticCatalog;
  applyCosmetics(room.cosmetics);
  renderCosmeticButtons(cosmeticCatalog, purchasedCosmetics, currentWallet);

  addStaticProps(); // no-op after first call; still repositions the barn below
  positionBarn(); // gridSize may have changed (e.g. plot expansion) — re-derive the barn's offset
  repositionCosmeticProps(); // same gridSize-changed concern as the barn above
  repositionDecor(); // same gridSize-changed concern as the barn/cosmetics above

  const overlay = document.getElementById('cold-start-overlay');
  if (overlay) overlay.remove();

  if (!localStorage.getItem(ONBOARDING_SEEN_KEY)) {
    openOnboarding();
  }
  showFirstActionHint();
});

socket.on('economyUpdate', ({ wallet, inventory, lastSale }) => {
  renderEconomy(wallet, inventory);
  currentWallet = wallet;
  renderExpandButton(currentGridSize, currentExpandCost, currentWallet);
  renderUpgradeButton(currentToolTier, currentUpgradeCost, currentWallet);
  renderCosmeticButtons(cosmeticCatalog, purchasedCosmetics, currentWallet);
  if (lastSale) {
    showToast(`Sold ${lastSale.count} wheat for ${lastSale.earned}g!`, 'success');
  }
});

socket.on('cosmeticsUpdated', ({ cosmetics }) => {
  applyCosmetics(cosmetics);
  renderCosmeticButtons(cosmeticCatalog, purchasedCosmetics, currentWallet);
  showToast('Cosmetic purchased!', 'success');
});

socket.on('toolTierUpdated', ({ toolTier, upgradeCost }) => {
  currentToolTier = toolTier;
  currentUpgradeCost = upgradeCost;
  renderUpgradeButton(currentToolTier, currentUpgradeCost, currentWallet);
  showToast(`Tool upgraded! Now affects a ${toolTier === 1 ? '3x3' : '5x5'} area.`, 'success');
});

socket.on('playerJoined', (player) => {
  statusEl.textContent = statusEl.textContent.replace(/\d+\/\d+/, (s) => {
    const n = parseInt(s, 10);
    return `${n + 1}/${maxPlayers}`;
  });
  if (player?.id) {
    knownPlayerIds.add(player.id);
    spawnAvatarForPlayer(player.id); // visible immediately at avatarSpawnOrigin(), same as roomState's own players
  }
});

socket.on('playerLeft', ({ id }) => {
  statusEl.textContent = statusEl.textContent.replace(/\d+\/\d+/, (s) => {
    const n = parseInt(s, 10);
    return `${Math.max(0, n - 1)}/${maxPlayers}`;
  });
  knownPlayerIds.delete(id);
  removeAvatarForPlayer(id);
});

socket.on('tilesUpdated', (tiles) => {
  tiles.forEach(queuePendingTile);
});

// Authoritative position push: fired on every accepted action (see
// server.js), independent of tilesUpdated so avatar placement isn't tied to
// which tiles a splash-radius tool action happened to touch.
socket.on('playerMoved', ({ id, x, y }) => {
  if (!knownPlayerIds.has(id)) return;
  spawnAvatarForPlayer(id).then(() => placeAvatarOnTile(id, x, y));
});

socket.on('actionRejected', ({ message, collision, actorName, verbPast, x, y }) => {
  if (collision) {
    const who = actorName || 'Another farmer';
    const verb = verbPast || 'changed';
    showToast(`Too slow — ${who} already ${verb} that tile!`, 'collision');
    if (typeof x === 'number' && typeof y === 'number') flashTile(x, y);
  } else {
    showToast(message, 'error');
  }
});

// --- Render loop ---
resize();
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  mixers.forEach((mixer) => mixer.update(delta));
  // Move each avatar toward its target tile position instead of snapping in
  // placeAvatarOnTile(), so every move — including the very first login
  // walk-in from avatarSpawnOrigin() — reads as a walk rather than a
  // teleport. Constant-speed (not the old exponential ease-decay, which
  // moved fastest at the start and crawled into the stop — a real walking
  // gait holds a steady pace and then arrives) with a final snap once
  // within ARRIVE_EPSILON so it doesn't crawl asymptotically forever.
  const AVATAR_WALK_SPEED = 1.5; // world units/sec
  const ARRIVE_EPSILON = 0.02;
  playerAvatars.forEach((avatar, playerId) => {
    if (!avatar?.object3D) return;
    const pos = avatar.object3D.position;
    const dx = avatar.targetX - pos.x;
    const dz = avatar.targetZ - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ARRIVE_EPSILON) {
      const step = Math.min(dist, AVATAR_WALK_SPEED * delta);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      // Face the direction of travel — a straight-on slide with no turn is
      // what reads as "gliding" rather than "walking" even once the motion
      // itself is smooth.
      const heading = Math.atan2(dx, dz);
      let angleDiff = heading - avatar.object3D.rotation.y;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff)); // shortest-path wrap
      avatar.object3D.rotation.y += angleDiff * Math.min(1, 10 * delta);
      if (!avatar.isWalking && avatar.walkAction && avatar.idleAction) {
        avatar.isWalking = true;
        avatar.idleAction.crossFadeTo(avatar.walkAction.reset().play(), 0.15, false);
      }
    } else {
      pos.x = avatar.targetX; // snap the last fraction shut instead of an infinite ease-in tail
      pos.z = avatar.targetZ;
      if (avatar.isWalking && avatar.walkAction && avatar.idleAction) {
        avatar.isWalking = false;
        avatar.walkAction.crossFadeTo(avatar.idleAction.reset().play(), 0.25, false);
      }
      // Only once the avatar has actually arrived does whatever action
      // caused this trip become visible (crop/soil change) — see
      // queuePendingTile()/flushPendingTilesForPlayer() above.
      flushPendingTilesForPlayer(playerId);

      // Local player, arrived with a queued click waiting: this is the tile
      // that click was for, so the server action (and its SFX) fires now —
      // on arrival, not on click — then moves on to whatever's queued next.
      if (playerId === socket.id && actionQueue.length > 0) {
        const job = actionQueue.shift();
        socket.emit('action', { type: job.type, x: job.x, y: job.y });
        playSfx(job.type);
        if (actionQueue.length > 0) {
          const next = actionQueue[0];
          placeAvatarOnTile(socket.id, next.x, next.y);
        }
        return; // handled this frame — idle wandering picks back up once the queue is empty
      }

      // Ambient idle wandering: with nothing queued, avatars roam freely
      // around the farm (a fresh random point each time, not a small nudge
      // back to one spot) so a parked avatar reads as a living character
      // instead of a static prop. A real placeAvatarOnTile() call (a new
      // queued click for the local player, or another player's own action)
      // always overrides this the moment it happens.
      avatar.wanderTimer -= delta;
      if (avatar.wanderTimer <= 0) {
        const [rx, rz] = randomRoamPoint();
        avatar.targetX = rx;
        avatar.targetZ = rz;
        avatar.wanderTimer = 2 + Math.random() * 3; // only rechecked once this next spot is reached
      }
    }
  });
  if (hintRing) {
    const t = (performance.now() - hintRingStart) / 1000;
    hintRing.position.y = 0.5 + Math.sin(t * 2.4) * 0.08;
    hintRing.rotation.z = t * 1.2;
  }
  renderer.render(scene, camera);
}
animate();
