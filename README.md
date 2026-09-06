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
Its URL and publishable key are configured in Netlify, and all four migrations
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
