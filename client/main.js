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

const statusEl = document.getElementById('status');
const economyEl = document.getElementById('economy');
const sellBtn = document.getElementById('sell-btn');
const expandBtn = document.getElementById('expand-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
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
expandBtn.addEventListener('click', () => socket.emit('expandPlot'));
upgradeBtn.addEventListener('click', () => socket.emit('upgradeTool'));

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

inviteBtn.addEventListener('click', () => copyInviteLink(inviteBtn));
onboardCopyLinkBtn.addEventListener('click', () => copyInviteLink(onboardCopyLinkBtn));
helpBtn.addEventListener('click', openOnboarding);
onboardDismissBtn.addEventListener('click', closeOnboarding);
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
  // Margin beyond the grid's own extent, so camera-framed dressing (barn,
  // fence line) clears the grid instead of clipping into it. Was a flat +1,
  // which was tight enough that the corner-decoration barn either had to
  // sit close enough to overlap tile (0,0) or fall outside the frustum
  // entirely once pushed clear of the grid — this camera is tilted, and the
  // tilt eats into vertical headroom faster than horizontal, so the margin
  // needs to be generous enough to cover that, not just "the grid + a bit".
  return (gridSize * (TILE_SIZE + TILE_GAP)) / 2 + 2.6;
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

  // A co-op partner acting on the hint tile before the local player does is
  // itself the teaching moment ("oh, that's how it works") — clear the hint
  // the same way a local click would instead of leaving a stale ring.
  if (tile.x === 0 && tile.y === 0 && tile.stage !== 'empty') clearFirstActionHint();

  // Only spawn/place an avatar for players still actually connected — a
  // save file's tiles can carry `lastActionBy` ids from a previous session
  // that already disconnected, and those shouldn't leave a ghost avatar.
  if (tile.lastActionBy && knownPlayerIds.has(tile.lastActionBy)) {
    spawnAvatarForPlayer(tile.lastActionBy).then(() => placeAvatarOnTile(tile.lastActionBy, tile.x, tile.y));
  }

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
// player's avatar is placed on whichever tile they most recently acted on,
// derived client-side from `lastActionBy` on every tilesUpdated/roomState
// tile. This is a reasonable proxy for "where is that player working" in a
// shared-plot co-op game and needs zero server changes — if a truer live
// cursor position is wanted later, the server needs a `cursorMoved` event
// and a per-player {x,y}, which is a game-engineer task, not an asset one.
const AVATAR_MODEL_NAMES = ['player_avatar_1', 'player_avatar_2'];
const avatarGroup = new THREE.Group();
scene.add(avatarGroup);

const knownPlayerIds = new Set(); // socket.ids currently connected to this room, per roomState/playerJoined/playerLeft
const playerAvatars = new Map(); // socket.id -> { object3D, mixer, modelName }
const mixers = []; // flat list of active AnimationMixers, updated every frame
let nextAvatarModelIndex = 0;

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
    object3D.position.set(0, groundY, 0); // parked at origin until a tile action places it
    object3D.visible = false; // hidden until we know a real tile to place it on

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
      walkTimeout: null,
      // Target world position for this frame's interpolation, and whether
      // we've ever placed this avatar yet (first placement should snap, not
      // walk in from the origin parking spot).
      targetX: object3D.position.x,
      targetZ: object3D.position.z,
      hasBeenPlaced: false,
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
    if (avatar.walkTimeout) clearTimeout(avatar.walkTimeout);
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
  const moved = avatar.tileKey !== null && avatar.tileKey !== key;
  avatar.tileKey = key;
  const [wx, wz] = worldPos(x, y);
  avatar.targetX = wx;
  avatar.targetZ = wz + AVATAR_TILE_EDGE_OFFSET;
  avatar.object3D.visible = true;
  // First placement (avatar was parked at the origin, invisible) should snap
  // straight to its tile rather than visibly sliding in from (0,0) the
  // instant it appears; every placement after that interpolates smoothly in
  // the render loop below instead of teleporting frame-to-frame.
  if (!avatar.hasBeenPlaced) {
    avatar.object3D.position.x = wx;
    avatar.object3D.position.z = avatar.targetZ;
    avatar.hasBeenPlaced = true;
  }

  // Sell a moment of "walking" whenever the avatar actually changes tiles
  // (not on the very first placement, and not on repeat actions on the same
  // tile) — this is a snap-to-tile position update, not continuous
  // locomotion, so a real walk cycle synced to travel isn't available; a
  // brief crossfade is the honest amount of motion this data supports.
  if (moved && avatar.walkAction && avatar.idleAction) {
    if (avatar.walkTimeout) clearTimeout(avatar.walkTimeout);
    avatar.idleAction.crossFadeTo(avatar.walkAction.reset().play(), 0.15, false);
    avatar.walkTimeout = setTimeout(() => {
      avatar.walkAction.crossFadeTo(avatar.idleAction.reset().play(), 0.25, false);
      avatar.walkTimeout = null;
    }, 500);
  }
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
  socket.emit('action', { type: activeTool, x, y });
  clearFirstActionHint();
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
  actOnTile: (tool, x, y) => socket.emit('action', { type: tool, x, y }),
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

  addStaticProps(); // no-op after first call; still repositions the barn below
  positionBarn(); // gridSize may have changed (e.g. plot expansion) — re-derive the barn's offset

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
  if (lastSale) {
    showToast(`Sold ${lastSale.count} wheat for ${lastSale.earned}g!`, 'success');
  }
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
  if (player?.id) knownPlayerIds.add(player.id);
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
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  mixers.forEach((mixer) => mixer.update(delta));
  // Interpolate each avatar toward its target tile position instead of
  // snapping in placeAvatarOnTile(), so a tile-to-tile move reads as a walk
  // rather than a teleport. Frame-rate independent (exponential decay driven
  // by delta, not a fixed per-frame step) so it looks the same at 30fps or
  // 144fps. AVATAR_MOVE_SPEED is a decay-rate constant, not a literal
  // units/sec speed, but larger = faster convergence.
  const AVATAR_MOVE_SPEED = 8;
  playerAvatars.forEach((avatar) => {
    if (!avatar?.object3D) return;
    const pos = avatar.object3D.position;
    const dx = avatar.targetX - pos.x;
    const dz = avatar.targetZ - pos.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    const t = 1 - Math.exp(-AVATAR_MOVE_SPEED * delta);
    pos.x += dx * t;
    pos.z += dz * t;
  });
  if (hintRing) {
    const t = (performance.now() - hintRingStart) / 1000;
    hintRing.position.y = 0.5 + Math.sin(t * 2.4) * 0.08;
    hintRing.rotation.z = t * 1.2;
  }
  renderer.render(scene, camera);
}
animate();
