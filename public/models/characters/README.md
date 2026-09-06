# Editable village characters

Four original character assets authored for Blocktopia: Mara (hearth apron), Ivo (scholar book), Neri (mountain pack and scarf), and Sol (keeper lantern). No paid generation service is used.

Open https://web.blockbench.net/ and choose **Open Model**, then select a `.bbmodel` here. The files contain the complete cube geometry, named joint pivots, UV coordinates and embedded 64×64 painted palette texture. The adjacent PNGs are exported copies for external painting. Save the model back to the same filename to update the game on its next build. Editing the standalone PNG does not replace the embedded texture: import your edited PNG into Blockbench and save the model.

The game imports these exact sources in `src/game/characters.js`; there is no separate export step or duplicate hardcoded NPC model. The runtime supports Generic Model cubes, nested groups, cube/group rotations and face UV rotations. Keep one texture per model and keep the `head`, `left_arm`, and `right_arm` group names for the procedural idle motion. Mesh elements, multiple textures and authored animation clips need importer support before use. Gameplay interaction remains anchored to village coordinates.

Recreate the initial authored sources with `python scripts/characters/generate.py` (overwrites model edits). Verify all four sources and their rig in-game format with `npx vitest run tests/character-assets.test.js`. Verify the sources open and serialize in the actual Blockbench editor with `python scripts/characters/verify-blockbench.py` (requires Python Playwright, Chrome and internet).
