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

The hosted game requires a hosted Supabase project. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` in Netlify's environment settings. Apply the
ordered migrations in `supabase/migrations/` to that project, then configure
Supabase Auth's Site URL as `https://play-blocktopia.netlify.app/` and allow the
same redirect URL for confirmation and password-reset links. Keep confirmation
email delivery configured for public signups. Only a publishable/anon key belongs
in the client; service-role keys must never be used there.

Netlify builds fail with an explicit configuration error if the hosted URL or
publishable key is absent, preserving the previous successful deployment.
`npm run play` uses local Supabase independently of Netlify settings.

Optional `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` enable
a TURN relay for restrictive networks. Netlify serves the client; it does not
replace Supabase or provide that relay. Browser-visible TURN credentials must
be scoped appropriately by the relay provider.

## Free editable assets

- Character sources and Blockbench workflow: [public/models/characters/README.md](public/models/characters/README.md).
- Actual Watabou export and terrain adapter: [public/maps/README.md](public/maps/README.md).
- Material Maker log-end PBR graph and export workflow: [scripts/materials/README.md](scripts/materials/README.md).
- Existing PBR scans retain their sources in `public/textures/pbr/provenance.json`.
- Cinematic sources and optimized-file hashes are in `public/media/provenance.json`.

New worlds use terrain generation 3, which adds generated woodland approaches.
Saved generations 1 and 2 retain their original terrain. Character source edits
are bundled at build time, so saving a `.bbmodel` and pushing it updates the game.
