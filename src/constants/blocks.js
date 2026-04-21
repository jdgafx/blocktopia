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

// UV tile coords [col, row] in the 16×16 atlas grid
export const BLOCK_DEFS = {
  [BLOCKS.AIR]:        { name: 'Air',         solid: false, transparent: true,  top:[0,0], side:[0,0], bot:[0,0] },
  [BLOCKS.GRASS]:      { name: 'Grass',        solid: true,  transparent: false, top:[0,0], side:[1,0], bot:[2,0] },
  [BLOCKS.DIRT]:       { name: 'Dirt',         solid: true,  transparent: false, top:[2,0], side:[2,0], bot:[2,0] },
  [BLOCKS.STONE]:      { name: 'Stone',        solid: true,  transparent: false, top:[3,0], side:[3,0], bot:[3,0] },
  [BLOCKS.WOOD_LOG]:   { name: 'Wood Log',     solid: true,  transparent: false, top:[4,0], side:[5,0], bot:[4,0] },
  [BLOCKS.LEAVES]:     { name: 'Leaves',       solid: true,  transparent: false, top:[6,0], side:[6,0], bot:[6,0] },
  [BLOCKS.SAND]:       { name: 'Sand',         solid: true,  transparent: false, top:[7,0], side:[7,0], bot:[7,0] },
  [BLOCKS.GRAVEL]:     { name: 'Gravel',       solid: true,  transparent: false, top:[8,0], side:[8,0], bot:[8,0] },
  [BLOCKS.PLANKS]:     { name: 'Planks',       solid: true,  transparent: false, top:[9,0], side:[9,0], bot:[9,0] },
  [BLOCKS.STONE_BRICK]:{ name: 'Stone Brick',  solid: true,  transparent: false, top:[10,0],side:[10,0],bot:[10,0]},
  [BLOCKS.GLASS]:      { name: 'Glass',        solid: true,  transparent: true,  top:[11,0],side:[11,0],bot:[11,0]},
  [BLOCKS.COAL_ORE]:   { name: 'Coal Ore',     solid: true,  transparent: false, top:[12,0],side:[12,0],bot:[12,0]},
  [BLOCKS.IRON_ORE]:   { name: 'Iron Ore',     solid: true,  transparent: false, top:[13,0],side:[13,0],bot:[13,0]},
  [BLOCKS.BEDROCK]:    { name: 'Bedrock',      solid: true,  transparent: false, top:[14,0],side:[14,0],bot:[14,0]},
  [BLOCKS.WATER]:      { name: 'Water',        solid: false, transparent: true,  top:[15,0],side:[15,0],bot:[15,0]},
};

export const HOTBAR_BLOCKS = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD_LOG,
  BLOCKS.LEAVES, BLOCKS.SAND, BLOCKS.PLANKS, BLOCKS.STONE_BRICK, BLOCKS.GLASS,
];
