export const BLOCKS = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD_LOG: 4,
  LEAVES: 5,
  SAND: 6,
  GRAVEL: 7,
  PLANKS: 8,
  STONE_BRICK: 9,
  GLASS: 10,
  COAL_ORE: 11,
  IRON_ORE: 12,
  BEDROCK: 13,
  WATER: 14,
});

// UV tile coordinates [column, row] in the 4x4 Electric Jurassic atlas.
export const BLOCK_DEFS = {
  [BLOCKS.AIR]:        { name: 'Air',         solid: false, transparent: true,  top:[0,0], side:[0,0], bot:[0,0] },
  [BLOCKS.GRASS]:      { name: 'Grass',        solid: true,  transparent: false, top:[0,0], side:[1,0], bot:[2,0] },
  [BLOCKS.DIRT]:       { name: 'Dirt',         solid: true,  transparent: false, top:[2,0], side:[2,0], bot:[2,0] },
  [BLOCKS.STONE]:      { name: 'Stone',        solid: true,  transparent: false, top:[3,0], side:[3,0], bot:[3,0] },
  [BLOCKS.WOOD_LOG]:   { name: 'Wood Log',     solid: true,  transparent: false, top:[0,1], side:[1,1], bot:[0,1] },
  [BLOCKS.LEAVES]:     { name: 'Leaves',       solid: true,  transparent: false, top:[2,1], side:[2,1], bot:[2,1] },
  [BLOCKS.SAND]:       { name: 'Sand',         solid: true,  transparent: false, top:[3,1], side:[3,1], bot:[3,1] },
  [BLOCKS.GRAVEL]:     { name: 'Gravel',       solid: true,  transparent: false, top:[0,2], side:[0,2], bot:[0,2] },
  [BLOCKS.PLANKS]:     { name: 'Planks',       solid: true,  transparent: false, top:[1,2], side:[1,2], bot:[1,2] },
  [BLOCKS.STONE_BRICK]:{ name: 'Stone Brick',  solid: true,  transparent: false, top:[2,2], side:[2,2], bot:[2,2] },
  [BLOCKS.GLASS]:      { name: 'Glass',        solid: true,  transparent: true,  top:[3,2], side:[3,2], bot:[3,2] },
  [BLOCKS.COAL_ORE]:   { name: 'Coal Ore',     solid: true,  transparent: false, top:[0,3], side:[0,3], bot:[0,3] },
  [BLOCKS.IRON_ORE]:   { name: 'Iron Ore',     solid: true,  transparent: false, top:[1,3], side:[1,3], bot:[1,3] },
  [BLOCKS.BEDROCK]:    { name: 'Bedrock',      solid: true,  transparent: false, top:[2,3], side:[2,3], bot:[2,3] },
  [BLOCKS.WATER]:      { name: 'Water',        solid: false, transparent: true,  top:[3,3], side:[3,3], bot:[3,3] },
};

export const HOTBAR_BLOCKS = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD_LOG,
  BLOCKS.LEAVES, BLOCKS.SAND, BLOCKS.PLANKS, BLOCKS.STONE_BRICK, BLOCKS.GLASS,
];
