# Changelog

All notable player-facing changes to Harvest Hollow are documented here.
Versioning: simple incrementing (`MAJOR.MINOR.PATCH`) — this is a solo/small-team
web game with no save-compatibility surface to protect, so version bumps track
"is this a meaningfully new build" rather than strict semver API rules.

## [1.0.0] — 2026-07-30

First public release. Harvest Hollow is a free, browser-based co-op farm-sim —
grab a friend, share your farm's invite link, and grow, water, and harvest crops
together on one shared plot.

### Added
- Core farm loop: till, plant, water, and harvest tiles on a shared 6x6 plot,
  with a shared team wallet (sell crops together, spend gold together).
- Invite-link room join — open the game, share the URL it generates, and a
  second player lands in the same farm automatically. Up to 6 players per farm.
- Progression: expand your plot and upgrade your tools by spending gold earned
  from selling crops.
- Cosmetic decorations (painted fence, well, windmill) as an optional gold sink
  once the farm is established.
- Player avatars with walk animation, visible to every player in the room.
- Crop wilting: an unwatered planted tile will wilt and need retilling —
  watering is a real job, not a formality.
- Collision feedback: if two players act on the same tile at once, the loser
  gets a clear "someone beat you to it" toast instead of a silent no-op.
- First-visit onboarding card (reopenable via the "?" button), one-click invite
  link copy, and a pulsing hint ring to nudge new players toward their first
  action.
- Action sound effects for till/plant/water/harvest/sell/UI, with a mute toggle.
- Mobile-responsive layout — playable on a phone browser, touch-friendly
  44px+ targets throughout.
- Automatic farm save/resume — a room's progress persists on the server and
  reloads the next time anyone opens that room's link, including after a
  server restart.

### Notes
- This is a co-op experience by design — it needs a second player (or more,
  up to 6) sharing the same invite link. It is not meant to be played solo.
- The server is hosted on a free tier and spins down after 15 minutes of
  inactivity; the first load after idle can take 30-60 seconds to wake up.
