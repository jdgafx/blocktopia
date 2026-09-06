import { BLOCK_DEFS, HOTBAR_BLOCKS } from '../constants/blocks.js';

export function initHUD(player) {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;

  HOTBAR_BLOCKS.forEach((blockId, i) => {
    const slot = document.createElement('button');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    const name = BLOCK_DEFS[blockId]?.name ?? '';
    slot.title = name;
    slot.dataset.label = name;
    slot.tabIndex = 0;
    slot.type = 'button';
    slot.setAttribute('aria-pressed', String(i === 0));
    slot.addEventListener('click', () => player.selectBlock(i));
    slot.setAttribute('aria-label', name);
    const [column, row] = BLOCK_DEFS[blockId]?.top ?? [0, 0];
    slot.style.setProperty('--tile-x', `${column * 100 / 3}%`);
    slot.style.setProperty('--tile-y', `${row * 100 / 3}%`);
    hotbar.appendChild(slot);
  });
}
