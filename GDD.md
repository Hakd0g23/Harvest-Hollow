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
- Exactly 2 players per farm (room), invite-link based, no matchmaking for v1.
- Sessions are persistent-ish: the farm state should survive a disconnect/reconnect (server holds authoritative state), not reset on refresh.

## Content Scope (v1 / MVP)
- One farm plot, fixed grid size (TBD, start small e.g. 6x6 tillable tiles).
- 2–3 crop types with different growth times, sourced from Quaternius's Ultimate Crops Pack.
- Simple currency: sell harvested crops, no shop UI polish required for MVP (a flat sell-all-for-gold action is enough).
- Farm animals (Quaternius Farm Animal Pack) as a stretch goal post-MVP — decorative first, produce-generating later.

## Explicitly Out of Scope (v1)
- More than 2 players.
- Combat, NPCs, quests, story.
- Seasons/weather/day-night cycle.
- Native mobile apps (browser-only, no App/Play Store build).

## Visual Style
Low-poly, stylized — matching the Quaternius asset aesthetic used across Cube Blast. Bright, cozy color palette.

## Open Questions (for you to weigh in on)
- Growth timer length: real minutes (idle-friendly, session can be short) vs. much faster for tight play sessions?
- Grid size for MVP — 6x6, or larger?
- Should there be any solo-play fallback (1 player controls both roles), or is this strictly co-op-only?
