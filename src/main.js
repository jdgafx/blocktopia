import * as THREE from 'three';
import { World } from './engine/world.js';
import { Renderer } from './engine/renderer.js';
import { Player } from './game/player.js';
import { initTouchControls } from './game/touch.js';
import { initNPCs, updateNPCs, buildVillager, makeNameSprite } from './game/npc.js';
import { initHUD, initHints, initInventory } from './ui/hud.js';
import { createExplosions } from './game/explosions.js';
import { BLOCKS } from './constants/blocks.js';
import {
  watchAuth, signUp, logIn, playAsGuest, logOut, playerName,
  joinWorld, watchPlayerCount,
} from './net/firebase.js';

const RENDER_DIST = navigator.maxTouchPoints > 0 ? 2 : 4;
const SEED = 42;

const SHIRT_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f'];
function avatarSkin(uid) {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) | 0;
  return {
    shirt: SHIRT_COLORS[Math.abs(h) % SHIRT_COLORS.length],
    pants: '#37474f', skinTone: '#e8b88a', hair: '#3e2723',
  };
}

function startGame(user, chosenName) {
  const myName = user.displayName || chosenName || playerName(user);
  const canvas   = document.getElementById('canvas');
  const world    = new World(SEED);
  const renderer = new Renderer(canvas);
  const player   = new Player(world, renderer.camera);

  initHUD(player);
  initInventory(player);
  initTouchControls(player);
  window.__game = { world, player, renderer }; // E2E test hook

  function remeshChunk(cx, cz) {
    renderer.updateChunk(world.getChunk(cx, cz), world);
  }

  function remeshAround(wx, wz) {
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    remeshChunk(cx, cz);
    if ((((wx % 16) + 16) % 16) === 0)  remeshChunk(cx - 1, cz);
    if ((((wx % 16) + 16) % 16) === 15) remeshChunk(cx + 1, cz);
    if ((((wz % 16) + 16) % 16) === 0)  remeshChunk(cx, cz - 1);
    if ((((wz % 16) + 16) % 16) === 15) remeshChunk(cx, cz + 1);
  }

  // ---- multiplayer ----
  const remotes = new Map(); // uid -> { group, target }
  const net = joinWorld(user, {
    onPlayerJoin(uid, data) {
      const group = buildVillager({ skin: avatarSkin(uid) });
      group.add(makeNameSprite(data.name || 'Player'));
      renderer.scene.add(group);
      remotes.set(uid, { group, target: { x: data.x, y: data.y, z: data.z, yaw: data.yaw || 0 } });
    },
    onPlayerMove(uid, data) {
      const r = remotes.get(uid);
      if (r) r.target = { x: data.x, y: data.y, z: data.z, yaw: data.yaw || 0 };
    },
    onPlayerLeave(uid) {
      const r = remotes.get(uid);
      if (r) { renderer.scene.remove(r.group); remotes.delete(uid); }
    },
    onBlockChange(x, y, z, id) {
      if (world.getBlock(x, y, z) === id) return; // our own echo
      world.setBlock(x, y, z, id);
      remeshAround(x, z);
      window.__game.explosions?.onBlockPlaced(x, y, z, id); // remote TNT fuses too
    },
  }, myName);
  window.__game.net = net;
  window.__game.remotes = remotes;

  player._onBlockChanged = (wx, wy, wz) => {
    remeshAround(wx, wz);
    net.sendBlock(wx, wy, wz, world.getBlock(wx, wy, wz));
  };

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

  // Pass 1: find highest solid non-tree terrain block at spawn column
  const TREE_IDS = new Set([BLOCKS.LEAVES, BLOCKS.WOOD_LOG]);
  let surfaceY = 2;
  for (let y = 62; y >= 1; y--) {
    const id = world.getBlock(8, y, 8);
    if (id !== 0 && !TREE_IDS.has(id)) { surfaceY = y; break; }
  }
  // Pass 2: scan upward from surface until 2 consecutive air blocks found
  let spawnY = surfaceY + 1;
  for (let y = surfaceY + 1; y < 63; y++) {
    if (world.getBlock(8, y, 8) === 0 && world.getBlock(8, y + 1, 8) === 0) {
      spawnY = y;
      break;
    }
  }
  player.position.set(8.5, spawnY, 8.5); // block-centered: AABB stays in one column

  loadChunksAround(player.position.x, player.position.z);

  const { npcs, seaText } = initNPCs(world, renderer.scene, 8, 8);
  window.__game.npcs = npcs;
  initHints({ seaText });

  // ---- TNT + dino popping ----
  const applyBlock = (x, y, z, id) => {
    world.setBlock(x, y, z, id);
    remeshAround(x, z);
    net.sendBlock(x, y, z, id);
  };
  const explosions = createExplosions({ world, scene: renderer.scene, npcs, applyBlock });
  window.__game.explosions = explosions;
  const prevOnBlockChanged = player._onBlockChanged;
  player._onBlockChanged = (wx, wy, wz) => {
    prevOnBlockChanged(wx, wy, wz);
    explosions.onBlockPlaced(wx, wy, wz, world.getBlock(wx, wy, wz));
  };

  // punch dinos: 3 bops and they pop (then respawn)
  player.onAttack = () => {
    const dir = new THREE.Vector3();
    renderer.camera.getWorldDirection(dir);
    for (const npc of npcs) {
      if (!npc.def.dino || npc.popped) continue;
      const to = npc.position.clone().sub(player.position);
      const dist = to.length();
      if (dist > 4.5) continue;
      if (to.normalize().dot(dir) < 0.75) continue; // must be looking at it
      npc.hits = (npc.hits || 0) + 1;
      npc.group.scale.setScalar(0.9);
      setTimeout(() => npc.group.scale.setScalar(1), 120);
      if (npc.hits >= 3) { npc.hits = 0; explosions.popDino(npc); }
      break;
    }
  };

  // ---- intro story + quests ----
  const intro = document.getElementById('intro');
  const quests = document.getElementById('quests');
  if (!localStorage.getItem('blocktopia-intro-seen')) {
    intro.style.display = 'flex';
    document.exitPointerLock?.();
  } else {
    quests.style.display = 'block';
  }
  document.getElementById('intro-start')?.addEventListener('click', () => {
    intro.style.display = 'none';
    quests.style.display = 'block';
    localStorage.setItem('blocktopia-intro-seen', '1');
    document.getElementById('click-to-play')?.remove();
    document.body.requestPointerLock?.();
  });

  const questState = JSON.parse(localStorage.getItem('blocktopia-quests') || '{}');
  const markQuest = (id) => {
    document.getElementById(id)?.classList.add('done'); // always reflect in UI (incl. restore)
    if (!questState[id]) {
      questState[id] = true;
      localStorage.setItem('blocktopia-quests', JSON.stringify(questState));
    }
    if (['q-talk', 'q-break', 'q-bag', 'q-place', 'q-sea'].every(q => questState[q])) {
      const h = quests.querySelector('h3');
      if (h) h.textContent = '🎉 Quests complete! The world is yours';
    }
  };
  for (const [id, done] of Object.entries(questState)) if (done) markQuest(id);
  document.addEventListener('quest', (e) => {
    const d = e.detail;
    if (d === 'break') markQuest('q-break');
    if (d === 'place') markQuest('q-place');
    if (d === 'bag') markQuest('q-bag');
    if (d.startsWith?.('talk:Mira')) markQuest('q-talk');
  });

  let lastCX = Math.floor(player.position.x / 16);
  let lastCZ = Math.floor(player.position.z / 16);
  let lastTime = performance.now();

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;

    player.update(dt);
    updateNPCs(npcs, dt, player.position);
    net.sendPosition(player.position, player._yaw);
    for (const r of remotes.values()) {
      // smooth remote motion toward last known state
      r.group.position.x += (r.target.x - r.group.position.x) * Math.min(1, dt * 10);
      r.group.position.y += (r.target.y - r.group.position.y) * Math.min(1, dt * 10);
      r.group.position.z += (r.target.z - r.group.position.z) * Math.min(1, dt * 10);
      r.group.rotation.y = r.target.yaw;
    }

    // Safety: respawn if player falls through the world
    if (player.position.y < -20) {
      player.position.set(8.5, spawnY, 8.5); // block-centered: AABB stays in one column
      player._physics._vy = 0;
    }

    const cx = Math.floor(player.position.x / 16);
    const cz = Math.floor(player.position.z / 16);
    if (cx !== lastCX || cz !== lastCZ) {
      loadChunksAround(player.position.x, player.position.z);
      lastCX = cx; lastCZ = cz;
    }

    // sea quest: standing at a shore counts as finding it
    if (!questState['q-sea'] && Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) {
      const px = Math.floor(player.position.x), pz = Math.floor(player.position.z);
      for (let dx = -3; dx <= 3 && !questState['q-sea']; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (world.getBlock(px + dx, 21, pz + dz) === BLOCKS.WATER) { markQuest('q-sea'); break; }
        }
      }
    }

    // underwater tint when the camera (eye) is inside water
    const eyeIn = world.getBlock(
      Math.floor(player.position.x), Math.floor(player.position.y + 1.6), Math.floor(player.position.z),
    ) === BLOCKS.WATER;
    const wo = document.getElementById('water-overlay');
    if (wo) wo.style.display = eyeIn ? 'block' : 'none';

    const info = document.getElementById('info');
    if (info) {
      const p = player.position;
      const compass = 'N NE E SE S SW W NW'.split(' ')[((Math.round(-player._yaw / (Math.PI / 4)) % 8) + 8) % 8];
      info.textContent = `${myName} · XYZ: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · Facing ${compass} · FPS: ${Math.round(1/dt)}`;
    }

    renderer.render();
  }

  loop();
}

// ---- auth flow: start screen -> game; login persists across visits ----

function initAuth() {
  const screen = document.getElementById('auth-screen');
  const errEl  = document.getElementById('auth-error');
  const nameEl = document.getElementById('auth-name');
  const emailEl = document.getElementById('auth-email');
  const passEl  = document.getElementById('auth-password');
  const logoutBtn = document.getElementById('btn-logout');
  let started = false;

  watchPlayerCount((n) => {
    const el = document.getElementById('online-count');
    if (el) el.textContent = n === 1 ? '1 player online' : `${n} players online`;
  });

  const fail = (e) => {
    errEl.textContent = (e.code || e.message || String(e))
      .replace('auth/', '').replaceAll('-', ' ');
  };

  document.getElementById('btn-guest').addEventListener('click', () => {
    playAsGuest(nameEl.value.trim()).catch(fail);
  });
  document.getElementById('btn-signup').addEventListener('click', () => {
    const name = nameEl.value.trim() || emailEl.value.split('@')[0];
    signUp(name, emailEl.value.trim(), passEl.value).catch(fail);
  });
  document.getElementById('btn-login').addEventListener('click', () => {
    logIn(emailEl.value.trim(), passEl.value).catch(fail);
  });
  logoutBtn.addEventListener('click', () => {
    window.__game?.net?.leave();
    logOut().then(() => location.reload());
  });

  watchAuth((user) => {
    if (!user || started) return;
    started = true;
    screen.style.display = 'none';
    logoutBtn.style.display = 'block';
    const ctp = document.getElementById('click-to-play');
    if (ctp) ctp.style.display = 'flex';
    // signup/guest set displayName async after auth fires — pass typed name
    startGame(user, nameEl.value.trim());
  });
}

initAuth();
