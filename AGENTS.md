# Mini Game Web Agent Rules

## Required Post-Change Flow (Per Game Module)

When any game module under `apps/game-*` is modified, always run the following steps before considering the task done:

1. Build the changed game module.
- Example: `npm.cmd run build` (run inside the changed game app directory)

2. Sync built outputs to hub public games.
- Run from repo root: `node scripts/sync-games.mjs`

This build + sync flow is mandatory for every completed game-module change.
