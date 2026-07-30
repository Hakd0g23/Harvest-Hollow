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
import { io } from 'https://cdn.socket.io/4.8.1/socket.io.esm.min.js';

// --- Design decision (flagged for user): server URL is hardcoded for local dev ---
// No env/config layer yet since this never leaves localhost in this skeleton.
const SERVER_URL = 'http://localhost:4000';

const TOOLS = ['till', 'plant', 'water', 'harvest'];
let activeTool = 'till';

const statusEl = document.getElementById('status');
const economyEl = document.getElementById('economy');
const sellBtn = document.getElementById('sell-btn');
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(message, variant = 'error') {
  toastEl.textContent = message;
  toastEl.classList.toggle('toast--collision', variant === 'collision');
  toastEl.classList.toggle('toast--success', variant === 'success');
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.display = 'none'), 2000);
}

function renderEconomy(wallet, inventory) {
  const wheat = inventory?.wheat ?? 0;
  economyEl.textContent = `Gold: ${wallet} | Wheat: ${wheat}`;
}

sellBtn.addEventListener('click', () => socket.emit('sell'));

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
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
  return (gridSize * (TILE_SIZE + TILE_GAP)) / 2 + 1;
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
// Slight-angle top-down: mostly overhead, small tilt for depth perception.
camera.position.set(0, 14, 6);
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x223311, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 10, 5);
scene.add(sun);

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

async function loadModel(name) {
  if (modelPromiseCache.has(name)) return modelPromiseCache.get(name);
  const promise = (async () => {
    await manifestPromise; // ensure assetManifest is populated before lookup
    const entry = assetManifest[name];
    if (!entry) throw new Error(`No assets.json entry for "${name}"`);
    return new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath(ASSETS_BASE);
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

const tileGroup = new THREE.Group();
scene.add(tileGroup);

const tileMeshes = new Map(); // "x,y" -> { soilMesh, cropMesh, pendingToken }

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

// --- Static scene dressing (barn + fence line), loaded once real state arrives ---
let staticPropsAdded = false;
async function addStaticProps() {
  if (staticPropsAdded) return;
  staticPropsAdded = true;
  const half = frustumHalfExtent();

  try {
    const barnTemplate = await loadModel('barn');
    const barn = barnTemplate.clone(true);
    const groundY = normalizeToSize(barn, 2.2);
    barn.position.set(-(half - 0.6), groundY, -(half - 0.6));
    barn.rotation.y = Math.PI / 4;
    scene.add(barn);
  } catch (err) {
    console.error('[assets] failed to load barn', err);
  }

  try {
    const fenceTemplate = await loadModel('fence');
    const spacing = 0.9;
    const fenceCount = Math.max(1, Math.ceil((half * 2) / spacing));
    for (let i = 0; i < fenceCount; i++) {
      const fence = fenceTemplate.clone(true);
      const groundY = normalizeToSize(fence, 0.85);
      fence.position.set(-half + i * spacing, groundY, -half - 0.5);
      scene.add(fence);
    }
  } catch (err) {
    console.error('[assets] failed to load fence', err);
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

function actOnScreenPoint(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  console.log('[debug] pointer', pointer.x, pointer.y, 'tileGroup children', tileGroup.children.length, 'camera', camera.left, camera.right, camera.top, camera.bottom);
  console.log('[debug] camera pos', camera.position.toArray(), 'ray origin', raycaster.ray.origin.toArray(), 'ray dir', raycaster.ray.direction.toArray());
  const t0 = tileGroup.children[0];
  const wp = new THREE.Vector3();
  t0.getWorldPosition(wp);
  console.log('[debug] tile0 world pos', wp.toArray(), 'visible', t0.visible);
  const hits = raycaster.intersectObjects(tileGroup.children, false);
  const hit = hits.find((h) => h.object.userData && typeof h.object.userData.x === 'number');
  console.log('[debug] actOnScreenPoint hits:', hits.length, 'hit:', hit && hit.object.userData);
  if (!hit) return;
  const { x, y } = hit.object.userData;
  console.log('[debug] emitting action', activeTool, x, y);
  socket.emit('action', { type: activeTool, x, y });
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

socket.on('roomState', (room) => {
  buildGrid(room.gridSize);
  room.tiles.forEach(applyTile);
  maxPlayers = room.maxPlayers;
  statusEl.textContent = `connected — ${room.players.length}/${maxPlayers} players`;
  renderEconomy(room.wallet, room.inventory);
  addStaticProps(); // no-op after first call
});

socket.on('economyUpdate', ({ wallet, inventory, lastSale }) => {
  renderEconomy(wallet, inventory);
  if (lastSale) {
    showToast(`Sold ${lastSale.count} wheat for ${lastSale.earned}g!`, 'success');
  }
});

socket.on('playerJoined', () => {
  statusEl.textContent = statusEl.textContent.replace(/\d+\/\d+/, (s) => {
    const n = parseInt(s, 10);
    return `${n + 1}/${maxPlayers}`;
  });
});

socket.on('playerLeft', () => {
  statusEl.textContent = statusEl.textContent.replace(/\d+\/\d+/, (s) => {
    const n = parseInt(s, 10);
    return `${Math.max(0, n - 1)}/${maxPlayers}`;
  });
});

socket.on('tilesUpdated', (tiles) => {
  console.log('[debug] tilesUpdated', tiles);
  tiles.forEach(applyTile);
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
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
