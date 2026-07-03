# Blocktopia — project memory

## What this is
Three.js voxel game (Minecraft-style), vanilla JS + Vite. Repo: https://github.com/jdgafx/blocktopia

## Deploy contract
- Push to `master` → GitHub Actions (`/home/chris2/dev/minecraft-roblox-clone/.github/workflows/deploy.yml`) → `netlify-cli deploy --prod` using repo secrets NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID (site 5fdd4aa9-7329-438a-af16-1073a59805f5).
- 2026-07-02: user wants migration to Vercel — Vercel MCP OAuth started, user has NOT completed authorization yet.

## Root cause of the historic "sinking through terrain" bug (FIXED 2026-07-02)
`src/engine/physics.js` `_resolveY` zeroed `this._vy` INSIDE the block loop → second solid block of the same floor row took the ceiling branch → teleported player down 1.8 every frame. Fix: decide floor/ceiling once from travel direction, `Math.max/min` accumulate, zero vy after loop. Regression test in `tests/physics.test.js` ("straddling a block boundary"). Spawn also block-centered at (8.5, y, 8.5).

## Graphics (2026-07-02 overhaul)
- Procedural 16x16 textures painted at runtime into 256x256 atlas: `src/ui/atlas.js` (seeded, deterministic). No external assets — no copyright exposure.
- Mesher: vertex AO + per-face shading via vertex colors; separate water geometry (`geo.water`); half-texel UV inset stops atlas bleed.
- Legacy face tables mix winding (top/bot CW, sides CCW) → solid material uses DoubleSide. Rewinding = known deferred cleanup.
- World gen: sea-level water fill (SEA_LEVEL=21 in world.js).

## Characters (2026-07-02)
`src/game/npc.js`: 3 villagers (Mira/Old Pete/Lily) + 2 fire dinosaurs (Blaze T-Rex, Cinder Raptor). Proximity dialog advances per-NPC storyline (lines double as tutorial). Fire = THREE.Points additive particles. Hints toast: `initHints()` in `src/ui/hud.js`.

## Testing
- `window.__game = { world, player, renderer, npcs }` E2E hook in main.js.
- Playwright MCP flaky here; use standalone scripts with `/home/chris2/dev/browser-automation/node_modules/playwright/index.mjs` + executablePath `/home/chris2/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` + `--enable-unsafe-swiftshader --no-sandbox` (WebGL in headless).

## Blocked / pending (2026-07-02)
- Auth (signup + persistent login) + multiplayer: plan = Supabase (auth + Realtime broadcast for multiplayer; free, no payment). BLOCKED: free tier 2-active-project limit (FreelanceAutopilot + meeting-transcriber active). User must pick: pause one, reuse one's auth, or other org.
- Vercel hosting migration: blocked on user completing MCP OAuth.
- User requirements: free game, no payment features, kid-friendly multiplayer server.
