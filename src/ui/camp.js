import { BLOCK_DEFS, HOTBAR_BLOCKS } from '../constants/blocks.js';
import { RECIPES, canCraft } from '../game/camp.js';

import { itemIcon } from './icons.js';
import { ITEM_DEFS, SUPPLY_IDS } from '../game/items.js';

export function initCampUI(session, player) {
  const panel = document.getElementById('camp-panel');
  const supplies = document.getElementById('camp-supplies');
  const recipes = document.getElementById('camp-recipes');
  const materials = new Map();
  const recipeButtons = new Map();
  const format = counts => Object.entries(counts).map(([id, amount]) => `${amount} ${ITEM_DEFS[id].name}`).join(' + ');
  for (const id of SUPPLY_IDS) {
    const item = document.createElement('span'); item.className = 'camp-material';
    supplies.append(item); materials.set(id, item);
  }
  for (const recipe of RECIPES) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'recipe secondary';
    button.dataset.recipe = recipe.id;
    const title = document.createElement('strong'); title.textContent = recipe.label;
    const cost = document.createElement('small'); cost.textContent = `${format(recipe.cost)} → ${format(recipe.output)}`;
    button.title = `Craft ${format(recipe.output)} using ${format(recipe.cost)}`;
    const picture = document.createElement('span'); picture.innerHTML = itemIcon(Object.keys(recipe.output)[0]);
    const text = document.createElement('span'); text.append(title, cost); button.append(picture, text);
    button.addEventListener('click', () => session.submitCraft(recipe.id));
    recipes.append(button); recipeButtons.set(recipe.id, button);
  }
  function openCamp() {
    document.exitPointerLock?.(); player.setActive(false); panel.open = true;
    panel.querySelector('summary').focus(); panel.scrollIntoView({ block: 'start' });
  }
  document.getElementById('open-camp').addEventListener('click', openCamp);
  player._onInventory = openCamp;
  return () => {
    const stock = session.ledger.supplies;
    const creative = session.mode === 'creative';
    document.getElementById('camp-description').textContent = creative
      ? 'Creative mode gives everyone unlimited building blocks.'
      : 'Gather blocks to supply your camp. Everyone shares these materials. Craft together, then build with what you make.';
    supplies.hidden = recipes.hidden = creative;
    for (const [id, item] of materials) {
      item.innerHTML = itemIcon(id);
      const label = document.createElement('span'); label.textContent = ITEM_DEFS[id].name;
      const count = document.createElement('strong'); count.textContent = stock[id] || 0; item.append(label, count);
      item.dataset.item = id; item.dataset.count = stock[id] || 0;
    }
    for (const [id, button] of recipeButtons) button.disabled = !session.snapshotReady || !canCraft(stock, id);
    document.querySelectorAll('.hotbar-slot').forEach((slot, i) => {
      const count = creative ? '∞' : stock[HOTBAR_BLOCKS[i]] || 0;
      let badge = slot.querySelector('.quantity');
      if (!badge) { badge = document.createElement('span'); badge.className = 'quantity'; slot.append(badge); }
      badge.textContent = count;
      slot.title = `${BLOCK_DEFS[HOTBAR_BLOCKS[i]].name} · ${count}`;
      slot.setAttribute('aria-label', slot.title);
    });
    document.getElementById('camp-goal').textContent = creative ? 'Creative · unlimited blocks'
      : (stock[8] || 0) > 0 ? 'Build your camp · place your crafted planks'
      : (stock[4] || 0) > 0 ? 'Craft planks · open Camp [E]'
      : 'Gather wood · hold Break on a tree trunk';
  };
}
