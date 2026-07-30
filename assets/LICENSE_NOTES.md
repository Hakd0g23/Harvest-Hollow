# Asset License Notes

All packs below are by **Quaternius** (https://quaternius.com/), sourced directly from the
official per-pack Google Drive download link linked on each pack's page. Every pack ships its
own `License.txt` (copied verbatim, see quotes below) and every one currently confirms:

**License: CC0 1.0 Universal (Public Domain Dedication)**
https://creativecommons.org/publicdomain/zero/1.0/

CC0 means no attribution is legally required and these assets can be used, modified, and
sold commercially without restriction. Attribution is appreciated by the author but optional —
see the per-pack notes below for the suggested credit line.

If you add any *other* asset packs from Quaternius later, don't assume CC0 by default — confirm
per-pack, since Quaternius has occasionally released packs under other terms. Re-check the
`License.txt` inside the download before treating a new pack as CC0.

---

## Ultimate Crops Pack
- Source: https://quaternius.com/packs/ultimatecrops.html
- Pack title in files: "Nature Crops Pack - Jan 2020"
- License: CC0 1.0 Universal
- Local path: `assets/ultimate-crops-pack/`
- Formats downloaded: `OBJ/` (OBJ + MTL, flat-color materials, no external texture maps) and `FBX/`
  (Blends/ source files were not downloaded — not usable by Three.js)
- 101 models (crop stages: growing/harvested variants for wheat, tomato, pumpkin, watermelon,
  rice, apple, bamboo, palm tree, etc.)

## Farm Animal Pack
- Source: https://quaternius.com/packs/farmanimal.html
- Pack title in files: "Farm Animals by @Quaternius"
- License: CC0 1.0 Universal
- Local path: `assets/farm-animal-pack/Farm Animals by @Quaternius/`
- Formats downloaded: `OBJ/` (OBJ + MTL) and `FBX/` (Blends/ source files not downloaded)
- 7 animals: Cow, Horse, Llama, Pig, Pug, Sheep, Zebra
- Suggested (optional) credit: "Farm Animals Pack was created by Quaternius — https://www.patreon.com/quaternius"

## Ultimate Nature Pack
- Source: https://quaternius.com/packs/ultimatenature.html
- License: CC0 1.0 Universal
- Local path: `assets/ultimate-nature-pack/`
- Formats downloaded: `OBJ/` (OBJ + MTL, flat-color materials) and `FBX/` (Blends/ not downloaded)
- 150 models — trees, rocks, bushes, logs, grass/foliage variants (including seasonal
  moss/snow variants) for general environment dressing around the farm.

## Farm Buildings Pack
- Source: https://quaternius.com/packs/farmbuildings.html
- License: CC0 1.0 Universal
- Local path: `assets/farm-buildings-pack/`
- Formats downloaded: `OBJ/` (OBJ + MTL) and `FBX/` (Blend/ not downloaded)
- 13 models: Barn, BigBarn, OpenBarn, SmallBarn, ChickenCoop, Fence, Fence2, Silo,
  Silo_House, TowerWindmill, Windmill, WaterTower, Well

## Ultimate Modular Men Pack (player avatars)
- Source: https://quaternius.com/packs/ultimatemodularcharacters.html
- Pack title in files: "Ultimate Modular Men- Feb 2022"
- License: CC0 1.0 Universal — confirmed via the pack page's footer link to
  https://creativecommons.org/publicdomain/zero/1.0/ (this pack's Google Drive
  download folder did not include its own `License.txt` at the "Individual
  Characters/glTF" level the way other packs' zips did; re-verify against a
  `License.txt` if you later pull additional files from the same Drive folder).
- Local path: `assets/ultimate-modular-men-pack/glTF/`
- Only 2 of 11 available pre-built characters were pulled (this is a subset,
  not the full pack) — enough to give two simultaneous co-op players visually
  distinct avatars without bloating the repo with the other 9 outfits + the
  Blend/FBX source formats, which weren't needed:
  - `Farmer.gltf` — used as `player_avatar_1`, thematically on-point for a farm co-op
  - `Casual_2.gltf` — used as `player_avatar_2`, visually distinct outfit/color from Farmer
- Format: single self-contained `.gltf` per character (buffers/textures
  embedded as base64, no separate `.bin`/texture files) — loads directly via
  Three.js `GLTFLoader`, no MTL step needed, unlike the OBJ packs above. Each
  file also ships all 24 animation clips baked onto one shared rig, but the
  client currently only uses a static pose (T-pose bind or one clip's first
  frame) — playing an idle/walk clip is a later stretch goal, not implemented.
- If a wider roster or gender variety is wanted later, the sibling pack
  "Ultimate Modular Women" pack is at
  https://quaternius.com/packs/ultimatemodularwomen.html, same CC0 terms,
  same glTF format — not pulled in this pass since 2 avatars already covers
  the current max simultaneous distinguishable need.

---

## Action SFX (audio pass, no ambient/music yet)
- Local path: `assets/sfx/` (7 one-shot `.ogg` files, all trimmed/renamed copies of
  the originals below — no pitch/EQ edits, just renamed for clarity)
- All three source packs are CC0 — no attribution legally required, safe for a
  commercial itch.io release; attribution given below anyway per each author's
  request where stated.

| File | Action | Source pack | Original filename | License |
|---|---|---|---|---|
| `till.ogg` | Till soil | Kenney — Impact Sounds | `Audio/impactMining_002.ogg` | CC0 1.0 |
| `plant.ogg` | Plant seed | Kenney — Impact Sounds | `Audio/impactSoft_medium_002.ogg` | CC0 1.0 |
| `water.ogg` | Water crop | rubberduck — "40 CC0 Water/Splash/Slime SFX" (OpenGameArt) | `splash_09.ogg` | CC0 1.0 |
| `harvest.ogg` | Harvest crop | Kenney — Interface Sounds | `Audio/pluck_001.ogg` | CC0 1.0 |
| `sell.ogg` | Sell / coin | Kenney — RPG Audio | `Audio/handleCoins.ogg` | CC0 1.0 |
| `ui_click.ogg` | Generic UI click | Kenney — Interface Sounds | `Audio/click_003.ogg` | CC0 1.0 |
| `toast.ogg` | Success / toast chime | Kenney — Interface Sounds | `Audio/confirmation_002.ogg` | CC0 1.0 |

- Kenney sources: https://kenney.nl/assets/impact-sounds ,
  https://kenney.nl/assets/interface-sounds , https://kenney.nl/assets/rpg-audio
  — all CC0 1.0 Universal, confirmed via each pack's bundled `License.txt`.
- Water source: https://opengameart.org/content/40-cc0-water-splash-slime-sfx
  by rubberduck, CC0, confirmed on the OpenGameArt listing page.
- All files are short one-shots (a few KB / well under a second to ~1s), fitting
  the "casual/light" brief — no looping ambience or music included in this pass,
  per current scope (ambient/music loop deferred to a later pass).
- Not yet wired into `client/main.js` — this pass only sources/places the files;
  wiring into the till/plant/water/harvest/sell/UI action handlers is a follow-up
  task for game-debugger.

## Ambient BGM

- Local path: `assets/audio/` (2 files: `bgm_cozy1_intro.opus`, `bgm_cozy1_loop.opus`)
- Pack: **"(FREE) Cozy Game Sound Pack (10 Tracks)"** by Living VideoGame Music Composer
- Source: https://livinggameaudio.itch.io/free-cozy-game-sound-pack-1
- License: Free, "name your own price" (downloaded at $0) — per the itch.io page and
  the pack's included Read Me: **"Use these tracks however you please, free of charge.
  No credit required"** (commercial use is fine; attribution is welcomed but optional,
  not required). The Read Me also states the music itself is **not AI-generated**
  ("I didn't use AI for the music in this pack. 100% handmade") — itch.io's page-level
  "AI Assisted" tag on this listing refers to the cover art/graphics only, not the audio,
  which is the only part of this pack actually used here.
- Track used: track "1-Ab-67 BPM" (slow, warm, gentle — fits the farm/cozy mood), using
  the pack's intro + main loop (with drums) segments out of its intro/loop/full-song set;
  no separate tail segment was included for this particular track (the pack's Read Me
  notes tails are only included "where possible" per song — a plain fade-out or the
  loop simply stopping is the fallback for tracks without one, which is what's used here).
- Format: Ogg Opus, 192kbps/44.1kHz (as shipped by the pack) — supported natively by
  Chrome/Firefox/Edge; if broad Safari/iOS support becomes a requirement later, these
  would need re-encoding to Ogg Vorbis or AAC, not currently done.
- Wired into `client/main.js` (search `--- BGM ---`): intro plays once via the Web Audio
  API scheduled back-to-back with the loop segment (avoids the audible seam gap an
  `<audio loop>` tag would have when stitching two separate files), then the loop
  segment repeats via native `AudioBufferSourceNode.loop`. Gated behind the existing
  `#mute-btn` toggle (same mute state as SFX — no separate BGM volume control exists yet).

## Format note for Three.js

None of these four packs ship a glTF/GLB export (Quaternius only provides Blend/FBX/OBJ for
these specific packs) — this is a per-pack fact, not a rule about Quaternius overall (other
Quaternius packs do include glTF). Load path options for Three.js:

- **OBJLoader + MTLLoader** (what was downloaded here) — simplest path, no rigging/animation
  data, fine for static props (crops, buildings, trees/rocks).
- **FBXLoader** — also downloaded per pack; only worth using over OBJ if you need the farm
  animals' embedded skeletal animation (FBX preserves rig/anim clips, OBJ does not).
- If you want glTF specifically (smaller binary, PBR-ready, generally the better long-term
  format for a Three.js pipeline), convert the FBX or OBJ through Blender's built-in glTF
  exporter once — a one-time conversion step, not a re-download.
