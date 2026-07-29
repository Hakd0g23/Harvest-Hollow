# Harvest Hollow — Game Design Document

## Elevator Pitch
A cozy, low-poly co-op farm sim for 2 players. You and a friend share one farm plot in real time — till, plant, water, and harvest together, sell crops, and grow the farm.

## Genre & Comparables
Cozy farming sim, real-time co-op. Closest reference: Stardew Valley's farming loop, but built for shared real-time play (not turn-based/async) rather than a full RPG/town sim.

## Platform
Web browser, cross-device (desktop, tablet, mobile) — plain HTML/JS, no app install required. Two players join the same room via a shareable link (same pattern as LuckyLanes). Must be playable on a phone's touch screen, not just mouse/keyboard.

## Core Loop
1. Till soil → 2. Plant seed → 3. Water → 4. Wait for growth (timer-based stages) → 5. Harvest → 6. Sell for currency → 7. Buy more seeds/upgrades → repeat.

Both players act on the same shared world simultaneously — the server is the single source of truth, so one player's till/plant/water/harvest action is visible to the other instantly.

## Co-op Design
- **Shared farm, shared economy.** One plot, one wallet — success depends on both players contributing, not two separate side-by-side farms.
- **Division of labor, not division of space.** Players aren't locked to "their" tiles; the fun is coordinating who tills, who waters, who harvests, especially as the farm grows faster than one player can keep up with.
- **No blocking griefing.** Any player can act on any tile — there's no lock/ownership system that lets one player wall the other out.

## Players & Session
- Solo-primary: one player can fully play the farm alone. Up to 6 players
  total can join the same farm (room) as optional helpers, invite-link
  based, no matchmaking for v1. (Revised 2026-07-30 — originally scoped as
  exactly 2 required; the actual intent is solo-first with room for a
  small group to help, not a fixed 2-player requirement.)
- Sessions are persistent-ish: the farm state should survive a disconnect/reconnect (server holds authoritative state), not reset on refresh.

## Content Scope (v1 / MVP)
- One farm plot, fixed grid size (TBD, start small e.g. 6x6 tillable tiles).
- 2–3 crop types with different growth times, sourced from Quaternius's Ultimate Crops Pack.
- Simple currency: sell harvested crops, no shop UI polish required for MVP (a flat sell-all-for-gold action is enough).
- Farm animals (Quaternius Farm Animal Pack) as a stretch goal post-MVP — decorative first, produce-generating later.

## Explicitly Out of Scope (v1)
- More than 6 players per farm.
- Combat, NPCs, quests, story.
- Seasons/weather/day-night cycle.
- Native mobile apps (browser-only, no App/Play Store build).

## Visual Style
Low-poly, stylized — matching the Quaternius asset aesthetic used across Cube Blast. Bright, cozy color palette.

## Resolved Questions (2026-07-30)
- Growth timer: 75s watered-to-grown, with a 45s unwatered-wilt mechanic. Real-time coordination pacing, not idle-minutes.
- Grid size: 6x6, kept — legible at a glance with a fixed camera.
- Solo/co-op: solo-primary with up to 6 optional helper players (see Players & Session above).
