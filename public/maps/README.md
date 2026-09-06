# Hearthwood woodland lanes

`hearthwood-watabou.json` is an unmodified JSON export downloaded from Watabou's
Medieval Fantasy City Generator 0.11.5 on 2026-09-06, with seed 260906.

Generator URL (explicit exported settings):
https://watabou.github.io/city-generator/?size=6&seed=260906&name=Hearthwood&citadel=1&urban_castle=0&plaza=1&temple=1&walls=1&shantytown=0&coast=1&river=0&greens=0&gates=-1&sea=0&export=json

Author and usage terms:
https://watabou.itch.io/medieval-fantasy-city-generator

The author permits copying, modification and commercial use of generated maps;
attribution is appreciated, not required. No generator source code is bundled.

Run `node scripts/maps/adapt-watabou.mjs` to regenerate the checked-in game data.
The adapter takes the first two exported road LineStrings, scales coordinates
by 0.2, translates their origin to Hearthwood (8,8), and rounds to voxel units.
Each approach connects to the existing town square. The smaller third road is
omitted because it overlaps the authored signal oak. Generation 3 uses the
adapted lanes for gravel, level ground, tree clearance and cave exclusion.
Generations 1 and 2 retain their existing terrain. Houses, landmarks, NPCs,
story locations and the four inter-region roads retain their authored positions.
