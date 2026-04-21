import { HOTBAR_BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';

export function initHUD() {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;

  HOTBAR_BLOCKS.forEach((blockId, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    slot.title = BLOCK_DEFS[blockId]?.name ?? '';

    const colors = [
      '#5d9e32','#8b6040','#7a7a7a','#8c6b2c',
      '#3a7a3a','#d4c86e','#b8874a','#888080','#c8e8f0',
    ];
    slot.style.background = colors[i] ?? '#555';
    slot.style.border = '2px solid #888';
    hotbar.appendChild(slot);
  });
}
