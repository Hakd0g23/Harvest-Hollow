# Project State — Harvest Hollow

| Workstream | Status | Stage | Artifacts | Class |
|---|---|---|---|---|
| deployment (client GH Pages + server Render) | done | delivered | README.md deploy section, commit d7ad0cf | must |
| shared wallet economy | done | delivered | server.js, commit ab6ecf8 | must |
| collision toast (simultaneous tile action) | done | delivered | client/main.js, server/server.js | must |
| dynamic maxPlayers | done | delivered | client/main.js:397-429, server.js:158 | must |
| farm save persistence | done | delivered | server/data/rooms/*.json, commit f46a1f3 | must |
| full specialist review panel (post-MVP-ship) | done | delivered | 4-agent findings synthesized 2026-07-30 | must |
| crash fix + cold-start overlay + cleanup + room-code fix | done | delivered | client/main.js, client/index.html, server/server.js | must |
| player avatars (Quaternius Ultimate Modular Men) | done | delivered | assets/ultimate-modular-men-pack, client/main.js avatar system; commit 9a4dc15, pushed to main | must |
| economy gold-sink: progression sink (plot expansion / tool upgrades) | done | delivered | server.js (expandPlot/upgradeTool, gridSize/toolTier), client/main.js, client/index.html; verified live 2026-07-30; commit 9a4dc15, pushed to main | should |
| economy gold-sink: cosmetic decor sink (fences, scarecrows, paint) | not started | scoped | queued after position-sync/barn-fix/audio land (shared main.js file risk); game-debugger | could |
| audio/sound pass (SFX for till/plant/water/harvest/sell/UI actions, no ambient loop for this pass) | done | verified | assets/sfx/*.ogg, client/main.js playSfx pool, client/index.html mute button; Playwright-verified (correct sound per action, mute suppresses playback, zero console errors); commit a0f1ba4 (local, not yet pushed) | should |
| run-harvest-hollow skill doc fix (growth timer says ~20s, actual is 75s) | done | delivered | .claude/skills/run-harvest-hollow/SKILL.md, also removed stale [debug]-log references | should |
| true server-side player position sync (avatars currently proxy via last-acted-tile) | done | verified | server/server.js (authoritative player.x/y, playerMoved event, expandPlot re-key), client/main.js (consumes roomState.players + playerMoved instead of lastActionBy scan); fixed a real resync ordering bug in the old proxy; Playwright-verified cross-client sync, zero console errors; commit pending | could |
| avatar/barn layering fix + idle-walk crossfade | done | delivered | client/main.js (avatar scale/edge-offset, barn diagonal placement math, walk crossfade on tile change); Playwright-verified 2026-07-30 (no console errors across rapid tile actions + player disconnect) | must |
| barn placement reactive to grid expansion | done | verified | client/main.js:576-597 (barn offset recomputes on every roomState/expandPlot resync); Playwright-verified; commit c026bc5, pushed to main | could |
| onboarding/tutorial + accessibility pass | done | delivered | client/index.html, client/main.js — first-visit onboarding card (localStorage-gated, reopenable via "?" help button), Invite button (clipboard copy of room link), pulsing skill-gate hint ring on tile (0,0) until first action (local or co-op partner), aria-live/role on toast + cold-start overlay, dialog semantics + Escape/click-outside on onboarding card, 44px+ touch targets on all new buttons; two-tab Playwright verification passed 2026-07-30 (overlay dismiss/reopen, invite clipboard copy, cross-player hint-ring clear); commit 9a4dc15, pushed to main | should |
| game-engineer design/market critique of core loop | done | delivered | findings synthesized 2026-07-30 | must |
| automated test coverage | not started | scoped | queued last of code work, after items 1-4 land, to cover them | should |
| store/marketing page (itch.io) | not started | scoped | hold until remaining fixes verified; release-manager | could |

| mobile: tool selection UI overlaps grid (responsive layout bug) | not started | scoped | user-reported 2026-07-30; slotted before cosmetic decor sink (same client files); game-debugger | must |
