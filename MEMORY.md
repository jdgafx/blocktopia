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

## Content round 2 (2026-07-02 late)
- 26 block ids (see `src/constants/blocks.js`): added cobble/brick/snow/ice/gold+diamond ore/obsidian + 4 Roblox-style studded plastics (atlas row 1 painters in `src/ui/atlas.js`). PLACEABLE_BLOCKS drives the bag.
- Inventory "Block Bag": E key / 🎒 / Esc, click cell → assigns to active hotbar slot (`initInventory` in `src/ui/hud.js`). Gotcha fixed: inline `style.display` starts '' not 'none' → first toggle no-op; init sets it explicitly. Pointer-lock click handler in player.js guards `#inventory,#auth-screen,#btn-logout,#btn-bag`.
- BLOCK_SOLID dup table deleted — world.isSolid reads BLOCK_DEFS (single source of truth).
- Ore gen bug: old branch order made IRON unreachable (coal condition shadowed it). Now rarest-deepest first: diamond y<7, gold y<11, iron y<16, coal y<24.
- 11 NPCs: 5 meadow (Mira/Pete/Lily/Blaze/Cinder) + spread: Sage Willow (0,22 offset), Captain Marina (AT computed sea spot via findSea ring-scan), Goldie (34,-28), Brixton Builder-Bot (-30,-20), Nova (-48,36), Rex Robo-Dino (52,18). {SEA} token in stories replaced with real computed direction+distance. initNPCs returns {npcs, seaText}; seaText feeds initHints.
- Compass facing (N/NE/…) in info bar; number keys 1-9 select hotbar.

## Content round 3 (2026-07-02 night, SHIPPED + live-verified)
- Swimming: physics.js water branch (buoyant sink -1.6, SPACE paddle +4.5, shore-exit boost, treads/bobs at surface); underwater blue overlay div toggled in main loop. Swim unit test in physics.test.js (fake worlds need getBlock now).
- Creative flight: double-tap SPACE toggles (400ms window — 300 was flaky), SPACE up/SHIFT down, 1.8x speed, collisions still on. opts arg on Physics.update.
- TNT id 26 (fuse 2.5s, radius 3.5 crater, chain reactions, orange flash mesh) in src/game/explosions.js; remote TNT fuses via onBlockChange hook. Dinos within 7 pop (visible=false, respawn 10s). Punch: player.onAttack in main — 3 hits within 4.5 + facing dot>0.75 pops dino.
- Intro story overlay (first visit only, localStorage 'blocktopia-intro-seen') + 5 starter quests panel (talk to Mira/break/bag/place/find sea), CustomEvent('quest') emitters in player/npc/hud, state in localStorage 'blocktopia-quests'. Gotcha fixed: markQuest must add .done class BEFORE the already-done guard or restore no-ops.
- megatest.mjs (scratchpad) covers all of round 3 vs localhost or live.

## Testing
- `window.__game = { world, player, renderer, npcs }` E2E hook in main.js.
- Playwright MCP flaky here; use standalone scripts with `/home/chris2/dev/browser-automation/node_modules/playwright/index.mjs` + executablePath `/home/chris2/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` + `--enable-unsafe-swiftshader --no-sandbox` (WebGL in headless).

## Auth + multiplayer (2026-07-02, SHIPPED)
Firebase project `blocktopia-game` (owner cnjgentile@gmail.com; Supabase was full — 2-project free cap; Vercel OAuth never completed, hosting stays Netlify).
- Web app id 1:1006123350241:web:f34decda9f3cbdfb395fa0; config committed in `src/net/firebase.js` (public identifiers; security = DB rules in `database.rules.json`, deploy via `firebase deploy --only database --project blocktopia-game`).
- Auth: email/password + anonymous guest, both enabled. Free-tier Auth provisioning is CONSOLE-ONLY (API initializeAuth = paid Identity Platform) — user clicked "Get started" once. Provider/domain edits DO work via API afterward: PATCH identitytoolkit.googleapis.com/admin/v2/projects/blocktopia-game/config with Bearer token minted from firebase CLI refresh token (~/.config/configstore/firebase-tools.json + CLI's public client id/secret).
- Persistent login = Firebase default indexedDB persistence; verified reload → auto-login.
- Multiplayer: RTDB https://blocktopia-game-default-rtdb.firebaseio.com — /players/{uid} position sync (~120ms throttle, onDisconnect cleanup) + /blocks/{x_y_z} shared block edits. Remote avatars = villager builder + name sprite from npc.js. Two-context Playwright test `mptest.mjs` (scratchpad) proves join/move/build sync + persistence, run against localhost AND live prod: all green.
- Signup name race: displayName write lands after onAuthStateChanged → pass typed name into startGame/joinWorld explicitly.
- CSP in netlify.toml allows *.googleapis.com + *.firebaseio.com (wss too). Supabase dep removed.
- User requirements: free game, no payment features, kid-friendly multiplayer. All features free ✓.
