import { World } from './engine/world.js';
import { Renderer } from './engine/renderer.js';
import { Player } from './game/player.js';
import { initTouchControls } from './game/touch.js';
import { initHUD } from './ui/hud.js';
import { BLOCKS } from './constants/blocks.js';

const RENDER_DIST = navigator.maxTouchPoints > 0 ? 2 : 4;
const SEED = 42;

function init() {
  const canvas   = document.getElementById('canvas');
  const world    = new World(SEED);
  const renderer = new Renderer(canvas);
  const player   = new Player(world, renderer.camera);

  initHUD();
  initTouchControls(player);

  player._onBlockChanged = (wx, _wy, wz) => {
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    remeshChunk(cx, cz);
    if ((wx % 16) === 0)  remeshChunk(cx - 1, cz);
    if ((wx % 16) === 15) remeshChunk(cx + 1, cz);
    if ((wz % 16) === 0)  remeshChunk(cx, cz - 1);
    if ((wz % 16) === 15) remeshChunk(cx, cz + 1);
  };

  function remeshChunk(cx, cz) {
    const chunk = world.getChunk(cx, cz);
    renderer.updateChunk(chunk, world);
  }

  function loadChunksAround(px, pz) {
    const cx = Math.floor(px / 16);
    const cz = Math.floor(pz / 16);
    for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
      for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
        const chunk = world.getChunk(cx + dx, cz + dz);
        if (chunk.dirty) remeshChunk(cx + dx, cz + dz);
      }
    }
  }

  // Find safe spawn Y: scan down for solid non-tree ground block
  const TREE_IDS = new Set([BLOCKS.LEAVES, BLOCKS.WOOD_LOG]);
  let spawnY = 70;
  for (let y = 62; y > 0; y--) {
    const id = world.getBlock(8, y, 8);
    if (id !== 0 && !TREE_IDS.has(id)) { spawnY = y + 2; break; }
  }
  player.position.set(8, spawnY, 8);

  loadChunksAround(player.position.x, player.position.z);

  let lastCX = Math.floor(player.position.x / 16);
  let lastCZ = Math.floor(player.position.z / 16);
  let lastTime = performance.now();

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;

    player.update(dt);

    // Safety: respawn if player falls through the world
    if (player.position.y < -20) {
      player.position.set(8, spawnY, 8);
      player._physics._vy = 0;
    }

    const cx = Math.floor(player.position.x / 16);
    const cz = Math.floor(player.position.z / 16);
    if (cx !== lastCX || cz !== lastCZ) {
      loadChunksAround(player.position.x, player.position.z);
      lastCX = cx; lastCZ = cz;
    }

    const info = document.getElementById('info');
    if (info) {
      const p = player.position;
      info.textContent = `XYZ: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  FPS: ${Math.round(1/dt)}`;
    }

    renderer.render();
  }

  loop();
}

init();
