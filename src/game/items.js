import { BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';

export const PROVISIONS = Object.freeze({ RAW_MEAT: 100, COOKED_MEAT: 101, HIDE: 102, FEATHER: 103, SCALE: 104, FORAGE: 105 });
export const BUILDING_ITEM_IDS = Object.freeze(Object.keys(BLOCK_DEFS).map(Number)
  .filter(id => ![BLOCKS.AIR, BLOCKS.BEDROCK, BLOCKS.WATER].includes(id)));
export const ITEM_DEFS = Object.freeze({ ...BLOCK_DEFS,
  100: { name: 'Raw meat' }, 101: { name: 'Cooked meat' }, 102: { name: 'Hide' },
  103: { name: 'Feathers' }, 104: { name: 'Scales' }, 105: { name: 'Fresh forage' },
});
export const SUPPLY_IDS = Object.freeze([...BUILDING_ITEM_IDS, ...Object.values(PROVISIONS)]);
