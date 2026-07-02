import { HOTBAR_BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';
import { tileDataURL } from './atlas.js';

export function initHUD() {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;

  HOTBAR_BLOCKS.forEach((blockId, i) => {
    const def = BLOCK_DEFS[blockId];
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
    slot.title = def?.name ?? '';
    // side tile reads better than top for most blocks (grass, logs)
    const [col, row] = def?.side ?? [0, 0];
    slot.style.backgroundImage = `url(${tileDataURL(col, row)})`;
    slot.style.backgroundSize = 'cover';
    slot.style.imageRendering = 'pixelated';
    hotbar.appendChild(slot);
  });
}
