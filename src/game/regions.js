export const REGIONS = Object.freeze([
  { id: 'hearthwood', name: 'Hearthwood', x: 8, z: 8,
    npc: { id: 'mara', name: 'Mara', role: 'Keeper of the hearth' },
    description: 'A woodland village gathered around the old signal oak.' },
  { id: 'amber-dunes', name: 'Amber Dunes', x: 104, z: 8,
    npc: { id: 'ivo', name: 'Ivo', role: 'Ruins scholar' },
    description: 'Wind-cut dunes surround a broken observatory and its buried vaults.' },
  { id: 'frostspine', name: 'Frostspine', x: 104, z: 104,
    npc: { id: 'neri', name: 'Neri', role: 'Mountain pathfinder' },
    description: 'Pale stone ridges and deep caverns shelter the watchtower settlement.' },
  { id: 'tideglass', name: 'Tideglass', x: 8, z: 104,
    npc: { id: 'sol', name: 'Sol', role: 'Lighthouse keeper' },
    description: 'A coastal haven of timber docks, tidal pools, and a glass beacon.' },
]);

export function getRegion(x, z) {
  return REGIONS.reduce((nearest, region) =>
    Math.hypot(x - region.x, z - region.z) < Math.hypot(x - nearest.x, z - nearest.z)
      ? region : nearest);
}
