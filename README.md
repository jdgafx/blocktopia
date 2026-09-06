# Blocktopia

A Three.js browser world with shared exploration, editable terrain, settlements,
creatures, camp crafting and account-owned saved expeditions.

## Play locally

Install Node.js, Docker and the Supabase CLI, then run:

```sh
npm ci
npm run play
```

Game: http://127.0.0.1:5173/
Local confirmation/reset inbox: http://127.0.0.1:54324/

Create an account, create a world, and share its room code with another player.
WASD moves; the front screen and in-game Controls button list all controls.
The local backend retains accounts and saves after the game process exits.

## Netlify and automatic updates

Site: https://play-blocktopia.netlify.app/
Repository: https://github.com/jdgafx/blocktopia
Production branch: `feature/core-engine`

Netlify is connected to GitHub through its deploy key and push webhook. Pushing
this branch triggers a build; Netlify publishes `dist` using `netlify.toml`.
The current working tree must be committed and pushed to appear in that build.

```sh
npm test
npm run build
git push origin feature/core-engine
```

The hosted backend is the `blocktopia` project in the existing `cgdarkstardev`
Supabase organization: https://supabase.com/dashboard/project/xuntmbxiupovuntwrqpr
Its URL and publishable key are configured in Netlify, and all six migrations
in `supabase/migrations/` are applied. Auth uses the live game URL and allows
redirects beneath it. Only a publishable/anon key belongs in the client;
service-role keys must never be used there.

Email/password signup enters the game immediately, with email confirmation off.
Public password-reset email delivery still requires custom SMTP: Supabase's
built-in sender only delivers to organization members. Configure SMTP before
enabling confirmation emails or relying on password recovery for other players.

Netlify builds fail with an explicit configuration error if the hosted URL or
publishable key is absent, preserving the previous successful deployment.
`npm run play` uses local Supabase independently of Netlify settings.

On the Netlify site, Three.js uses Netlify Image CDN for 512px WebP runtime
textures. The atlas retains its original dimensions for exact tile sampling.
Local development loads the source files directly; new source commits invalidate
Netlify's transformed copies as part of the deployment.

Optional `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` enable
a TURN relay for restrictive networks. Netlify serves the client; it does not
replace Supabase or provide that relay. Browser-visible TURN credentials must
be scoped appropriately by the relay provider.

## Hosted terrain and multiplayer

Account saves store changed voxels in `world_chunks.voxel_data` (`bytea`), grouped
into 16³ chunks using the BTV1 sparse binary format. Untouched terrain comes from
the saved seed and generation. `save_binary_expedition` atomically replaces chunk
blobs and updates the save revision; `load_binary_expedition` reads both from one
consistent database snapshot. Owner RLS isolates saves and chunks. Existing JSON
saves load normally and convert on their next save. Story, creatures, supplies,
and replay metadata remain in the expedition snapshot.

Voxel intents and commits also use private Supabase Realtime Broadcast. The
`broadcast_voxel_event` RPC verifies the registered account/peer binding and
stamps the sender; clients cannot publish directly to that topic. The host still
checks reach, inventory, epoch, replay IDs, and the 12-action/second limit. Ordered
WebRTC delivery and snapshots retain reconnect and late-join recovery; duplicate
voxel deliveries apply once. Movement continues over WebRTC.

Core models, textures, and audio remain static files under `public/`, delivered
by Netlify. There is currently no player-upload feature. Any future custom skins,
models, or map uploads must go directly to Supabase Storage with owner-scoped
policies, rather than attempting to write to Netlify's deployed filesystem.

## Browser performance and rendering

Graphics defaults to **Auto**. The game starts conservatively using device memory,
CPU concurrency and touch capability, then adjusts viewing distance, shadow-map
resolution and render resolution from sustained foreground frame times. Manual
Performance/Balanced/High choices persist on that device. Paused and hidden tabs
are excluded from tuning. All modes retain the world textures and character models.
The application can request high-performance WebGL; browser GPU acceleration and
operating-system power settings remain browser/user settings.

Netlify and the local Vite server/preview send COOP `same-origin` and COEP
`require-corp`. Isolated clients share terrain snapshots through SharedArrayBuffer;
other clients use transferred ArrayBuffers. At most two terrain workers generate
and greedily mesh chunks. Stale queued chunks are cancelled and newer edits replace
old mesh results. The initial world gate waits for its terrain and required textures.

Terrain uses tiled color/normal/packed ORM maps, vertex contact AO and adjacency-based
wet roughness. Water uses an opaque scene/depth capture for absorption, refraction
and shoreline foam, with matching distance fog. NPCs and peer avatars use optimized
GLBs with Meshopt geometry and KTX2 textures and grounded two-bone legs.

`npm run build` regenerates the character GLBs with a checksum-pinned native Linux
x64 gltfpack release and copies the matching Three.js Basis decoder into `public`.
No external asset origin is required at runtime. See the character README for the
reproducible authoring commands and supported build platform.

## Free editable assets

- Character sources and Blockbench workflow: [public/models/characters/README.md](public/models/characters/README.md).
- Actual Watabou export and terrain adapter: [public/maps/README.md](public/maps/README.md).
- Material Maker log-end PBR graph and export workflow: [scripts/materials/README.md](scripts/materials/README.md).
- Existing PBR scans retain their sources in `public/textures/pbr/provenance.json`.
- Runtime texture compression: `python scripts/textures/compress-runtime.py` (ImageMagick).
  Dimensions are preserved; original copies stay in ignored `output/texture-originals/`.
  `public/textures/runtime-encoding.json` records original and shipped hashes.
- Cinematic sources and optimized-file hashes are in `public/media/provenance.json`.

New worlds use terrain generation 3, which adds generated woodland approaches.
Saved generations 1 and 2 retain their original terrain. Character source edits
are bundled at build time, so saving a `.bbmodel` and pushing it updates the game.
