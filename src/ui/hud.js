import { HOTBAR_BLOCKS, BLOCK_DEFS } from '../constants/blocks.js';
import { tileDataURL } from './atlas.js';

const HINTS = [
  'WASD or arrow keys to walk, SPACE to jump',
  'Hold LEFT CLICK to break a block',
  'RIGHT CLICK to place the selected block',
  'Scroll the mouse wheel to change your hotbar block',
  'Walk up to the villagers — they each have a story to tell',
  'Coal and iron hide in the stone below — dig for dark and tan speckles',
  'There is a sea past the low lands. Sand means water is close',
  'Fall off the world? You respawn safe at the meadow',
];
const HINT_SECONDS = 10;
const HINT_CYCLES = 2;

export function initHints() {
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
