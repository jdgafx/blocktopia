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
  COBBLESTONE: 15,
  BRICK: 16,
  SNOW: 17,
  ICE: 18,
  GOLD_ORE: 19,
  DIAMOND_ORE: 20,
  OBSIDIAN: 21,
  PLASTIC_RED: 22,
  PLASTIC_BLUE: 23,
  PLASTIC_YELLOW: 24,
  PLASTIC_GREEN: 25,
  TNT: 26,
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
  [BLOCKS.COBBLESTONE]:{ name: 'Cobblestone',  solid: true,  transparent: false, top:[0,1], side:[0,1], bot:[0,1] },
  [BLOCKS.BRICK]:      { name: 'Brick',        solid: true,  transparent: false, top:[1,1], side:[1,1], bot:[1,1] },
  [BLOCKS.SNOW]:       { name: 'Snow',         solid: true,  transparent: false, top:[2,1], side:[2,1], bot:[2,1] },
  [BLOCKS.ICE]:        { name: 'Ice',          solid: true,  transparent: false, top:[3,1], side:[3,1], bot:[3,1] },
  [BLOCKS.GOLD_ORE]:   { name: 'Gold Ore',     solid: true,  transparent: false, top:[4,1], side:[4,1], bot:[4,1] },
  [BLOCKS.DIAMOND_ORE]:{ name: 'Diamond Ore',  solid: true,  transparent: false, top:[5,1], side:[5,1], bot:[5,1] },
  [BLOCKS.OBSIDIAN]:   { name: 'Obsidian',     solid: true,  transparent: false, top:[6,1], side:[6,1], bot:[6,1] },
  [BLOCKS.PLASTIC_RED]:   { name: 'Red Plastic',    solid: true, transparent: false, top:[7,1], side:[7,1], bot:[7,1] },
  [BLOCKS.PLASTIC_BLUE]:  { name: 'Blue Plastic',   solid: true, transparent: false, top:[8,1], side:[8,1], bot:[8,1] },
  [BLOCKS.PLASTIC_YELLOW]:{ name: 'Yellow Plastic', solid: true, transparent: false, top:[9,1], side:[9,1], bot:[9,1] },
  [BLOCKS.PLASTIC_GREEN]: { name: 'Green Plastic',  solid: true, transparent: false, top:[10,1],side:[10,1],bot:[10,1]},
  [BLOCKS.TNT]:           { name: 'TNT',            solid: true, transparent: false, top:[12,1],side:[11,1],bot:[12,1]},
};

export const HOTBAR_BLOCKS = [
  BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD_LOG,
  BLOCKS.PLANKS, BLOCKS.BRICK, BLOCKS.PLASTIC_RED, BLOCKS.PLASTIC_BLUE, BLOCKS.GLASS,
];

// everything a player may place from the inventory bag
export const PLACEABLE_BLOCKS = Object.keys(BLOCK_DEFS)
  .map(Number)
  .filter(id => id !== BLOCKS.AIR && id !== BLOCKS.WATER && id !== BLOCKS.BEDROCK);
