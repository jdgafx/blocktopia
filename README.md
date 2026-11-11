# Blocktopia Next Fable

Browser co-op dinosaur hunt: track Titans by day, chop specific body parts off them, butcher the
carcass, then haul the loot back to the Sanctuary through a blood eclipse while Shadow Raptors close in.

Three.js client, PartyKit multiplayer rooms, Cloudflare D1/R2/Pages for persistence and hosting.

## Run locally

```bash
npm install
npm run dev
```

The client is served on http://localhost:5173 and the room server on http://localhost:1999.
Open the page in two tabs (same `?room=` value) to play as a squad.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Shift / Space | Move, sprint, jump |
| Left-click | Swing the cleaver at the part under the crosshair, or saw a fallen carcass |
| Right-click or Q | Grapple onto a dinosaur part (again to release) |
| E | Pick up a chunk, or attach the truck's tow-winch to a heavy one |
| F | Flashlight |
| R | Call the Harvester Truck to your position |

## Layout

- `src/client/main.ts` – rendering, input, animation, HUD wiring
- `src/server/party.ts` – authoritative 20 Hz room: dinosaurs, part HP, chunks, truck, eclipse
- `src/server/api.ts`, `schema.sql`, `wrangler.toml` – D1 persistence worker (not yet called by the client)
- `src/shared/types.ts` – types shared by client and server
- `tools/build_models.py` – Blender script that builds every model in `public/models/`
- `blocktopia-next-fable-oneshot.mjs` – the original scaffold generator; it skips files that already exist

## Models

All art is generated procedurally with Blender's Python module and committed as `.glb` files.
To change a model, edit `tools/build_models.py` and rebuild:

```bash
pip install bpy numpy
npm run models
```

Each dinosaur file has one object per choppable part (named after the server's part names), a `Body`,
and `Pivot_*` / `Stump_*` empties that tell the client where limbs hinge and where wounds appear.
If a `.glb` is missing the client falls back to box placeholders.

## Known gaps

- "Extract" only shows a banner; nothing is written to D1 yet.
- The server trusts client-reported damage and positions.
- In production the client connects to the page's own host; point it at the deployed PartyKit host.
- Dinosaurs do not damage players.
