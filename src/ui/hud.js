import { HOTBAR_BLOCKS, PLACEABLE_BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';
import { tileDataURL } from './atlas.js';

const HINT_SECONDS = 10;
const HINT_CYCLES = 2;

// facts: { seaText } computed from the real world so hints never lie
export function initHints(facts = {}) {
  const HINTS = [
    'WASD or arrow keys to walk · SPACE to jump · move the mouse to look',
    'Hold LEFT CLICK on a block to break it',
    'RIGHT CLICK places your selected block',
    'Press E (or the 🎒 button) to open your block bag — 23 blocks to build with',
    'Number keys 1-9 or the mouse wheel pick a hotbar slot',
    facts.seaText || 'There is a sea at the low lands — sand means water is close',
    'Watch the Y number top-left: dig below 24 for coal, deeper for iron, gold, then diamond',
    'People and dinosaurs with name tags have stories — walk right up and they talk',
    'Everything you build is live — friends on this page see it instantly',
    'Fall off the world? No worries — you wake up back at the spawn meadow',
  ];
  const el = document.getElementById('hint');
  if (!el) return;
  let i = 0;
  const show = () => {
    if (i >= HINTS.length * HINT_CYCLES) { el.style.display = 'none'; return; }
    el.textContent = 'Hint: ' + HINTS[i % HINTS.length];
    el.style.display = 'block';
    i++;
    setTimeout(show, HINT_SECONDS * 1000);
  };
  show();
}

function slotBg(slot, blockId) {
  const def = BLOCK_DEFS[blockId];
  const [col, row] = def?.side ?? [0, 0];
  slot.style.backgroundImage = `url(${tileDataURL(col, row)})`;
  slot.style.backgroundSize = 'cover';
  slot.style.imageRendering = 'pixelated';
  slot.title = def?.name ?? '';
}

export function refreshHotbar(player) {
  document.querySelectorAll('.hotbar-slot').forEach((el, i) => {
    slotBg(el, player.hotbar[i]);
    el.classList.toggle('active', i === player.hotbarIdx);
  });
}

export function initHUD(player) {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;
  const source = player?.hotbar ?? HOTBAR_BLOCKS;
  source.forEach((blockId, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    slotBg(slot, blockId);
    hotbar.appendChild(slot);
  });
}

// creative-style block bag: click a block -> it goes into the active hotbar slot
export function initInventory(player) {
  const inv = document.getElementById('inventory');
  if (!inv) return;
  inv.style.display = 'none'; // inline value so the first toggle reads correctly
  const grid = document.getElementById('inventory-grid');

  for (const id of PLACEABLE_BLOCKS) {
    const cell = document.createElement('div');
    cell.className = 'inv-cell';
    slotBg(cell, id);
    cell.title = `${BLOCK_DEFS[id].name} — click to put in your selected hotbar slot`;
    cell.addEventListener('click', () => {
      player.hotbar[player.hotbarIdx] = id;
      refreshHotbar(player);
      toggle(false);
    });
    grid.appendChild(cell);
  }

  function toggle(open = inv.style.display === 'none') {
    inv.style.display = open ? 'flex' : 'none';
    if (open) document.exitPointerLock?.();
    else if (navigator.maxTouchPoints === 0) document.body.requestPointerLock?.();
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') toggle();
    if (e.code === 'Escape' && inv.style.display !== 'none') toggle(false);
  });
  document.getElementById('btn-bag')?.addEventListener('click', () => toggle());
  document.getElementById('inventory-close')?.addEventListener('click', () => toggle(false));
}
