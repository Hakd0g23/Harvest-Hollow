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

---

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
