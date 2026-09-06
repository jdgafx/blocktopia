import { BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';
import { BUILDING_ITEM_IDS, SUPPLY_IDS } from './items.js';

export const ITEM_IDS = BUILDING_ITEM_IDS;
export const MAX_SUPPLY = 1000000;
export const RECIPES = Object.freeze([
  { id: 'cook-meat', label: 'Cook meat over wood fire', cost: { 100: 1, [BLOCKS.WOOD_LOG]: 1 }, output: { 101: 1 } },
  { id: 'planks', label: 'Saw planks', cost: { [BLOCKS.WOOD_LOG]: 1 }, output: { [BLOCKS.PLANKS]: 4 } },
  { id: 'stone-brick', label: 'Cut stone bricks', cost: { [BLOCKS.STONE]: 4 }, output: { [BLOCKS.STONE_BRICK]: 4 } },
  { id: 'glass', label: 'Smelt glass', cost: { [BLOCKS.SAND]: 2, [BLOCKS.COAL_ORE]: 1 }, output: { [BLOCKS.GLASS]: 2 } },
].map((recipe) => Object.freeze({ ...recipe, cost: Object.freeze(recipe.cost), output: Object.freeze(recipe.output) })));

export function validSupplies(supplies) {
  return supplies !== null && typeof supplies === 'object' && !Array.isArray(supplies)
    && Object.keys(supplies).length <= SUPPLY_IDS.length
    && Object.entries(supplies).every(([id, count]) => String(Number(id)) === id
      && SUPPLY_IDS.includes(Number(id)) && Number.isSafeInteger(count) && count >= 0 && count <= MAX_SUPPLY);
}

export function canCraft(supplies, recipeId) {
  const recipe = RECIPES.find(({ id }) => id === recipeId);
  return !!recipe && validSupplies(supplies)
    && Object.entries(recipe.cost).every(([id, count]) => (supplies[id] ?? 0) >= count)
    && Object.entries(recipe.output).every(([id, count]) => (supplies[id] ?? 0) + count <= MAX_SUPPLY);
}

// Pure transaction: the host commits this result once, then peers copy the absolute supplies.
export function campAction(supplies, intent, currentBlock, mode = 'expedition') {
  if (!validSupplies(supplies)) return { ok: false, reason: 'Invalid camp supplies' };
  const next = { ...supplies };
  if (intent.kind === 'craft') {
    const recipe = RECIPES.find(({ id }) => id === intent.recipeId);
    if (!recipe) return { ok: false, reason: 'Unknown recipe' };
    if (!canCraft(supplies, recipe.id)) return { ok: false, reason: 'Gather the recipe ingredients first' };
    for (const [id, count] of Object.entries(recipe.cost)) next[id] -= count;
    for (const [id, count] of Object.entries(recipe.output)) next[id] = (next[id] ?? 0) + count;
  } else if (intent.blockId === BLOCKS.AIR) {
    if (!ITEM_IDS.includes(currentBlock)) return { ok: false, reason: 'There is no gatherable block here' };
    if (mode === 'expedition') {
      if ((next[currentBlock] ?? 0) >= MAX_SUPPLY) return { ok: false, reason: 'Camp storage is full for this block' };
      next[currentBlock] = (next[currentBlock] ?? 0) + 1;
    }
  } else {
    if (!ITEM_IDS.includes(intent.blockId)) return { ok: false, reason: 'Block id is not allowed' };
    if (currentBlock !== BLOCKS.AIR && currentBlock !== BLOCKS.WATER) return { ok: false, reason: 'That space is already occupied' };
    if (mode === 'expedition') {
      if (!(next[intent.blockId] > 0)) return { ok: false, reason: `Gather ${BLOCK_DEFS[intent.blockId].name.toLowerCase()} first` };
      next[intent.blockId]--;
    }
  }
  return { ok: true, supplies: Object.fromEntries(Object.entries(next).filter(([, count]) => count > 0)) };
}
