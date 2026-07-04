import * as THREE from 'three';
import { World } from './engine/world.js';
import { Renderer } from './engine/renderer.js';
import { Player } from './game/player.js';
import { initTouchControls } from './game/touch.js';
import { initNPCs, updateNPCs, buildVillager, makeNameSprite, HERD_NAMES } from './game/npc.js';
import { loadModels, spawnModel } from './game/models.js';
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
  loadModels(); // prefetch rigged characters; NPCs/avatars attach when ready
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
      const skin = avatarSkin(uid);
      const group = new THREE.Group();
      group.add(makeNameSprite(data.name || 'Player'));
      const r = { group, target: { x: data.x, y: data.y, z: data.z, yaw: data.yaw || 0 } };
      // animated character when models are ready; blocky villager otherwise
      loadModels().then(ok => {
        if (!remotes.has(uid)) return; // left before models arrived
        const tint = '#' + new THREE.Color(skin.shirt).lerp(new THREE.Color('#ffffff'), 0.55).getHexString();
        const m = ok && spawnModel('character', { height: 1.8, tint });
        if (m) { r.anim = m; group.add(m.group); }
        else group.add(buildVillager({ skin }));
      });
      renderer.scene.add(group);
      remotes.set(uid, r);
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

  // Spawn: spiral out from (8,8) for a column whose top terrain block has
  // nothing but air above it (open sky) — never bury a new player in a pit
  // or under a tree canopy.
  const TREE_IDS = new Set([BLOCKS.LEAVES, BLOCKS.WOOD_LOG]);
  const _colCache = new Map();
  function openColumnY(x, z) {
    const k = x + ',' + z;
    if (_colCache.has(k)) return _colCache.get(k);
    let surfaceY = 0;
    let out = null;
    for (let y = 62; y >= 1; y--) {
      const id = world.getBlock(x, y, z);
      if (id !== 0 && !TREE_IDS.has(id)) { surfaceY = y; break; }
    }
    if (surfaceY > 0 && world.getBlock(x, surfaceY, z) !== BLOCKS.WATER) {
      out = surfaceY + 1;
      for (let y = surfaceY + 1; y < 63; y++) {
        if (world.getBlock(x, y, z) !== 0) { out = null; break; } // canopy/overhang
      }
    }
    _colCache.set(k, out);
    return out;
  }
  // a real clearing: the column and the full 5x5 around it open to the sky,
  // so no tree canopy crowds the first frame a new player ever sees
  function columnSpawnY(x, z) {
    const y = openColumnY(x, z);
    if (y === null) return null;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (openColumnY(x + dx, z + dz) === null) return null;
      }
    }
    return y;
  }
  let spawn = { x: 8, z: 8, y: 30 };
  outer: for (let r = 0; r <= 40; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const y = columnSpawnY(8 + dx, 8 + dz);
        if (y !== null) { spawn = { x: 8 + dx, z: 8 + dz, y }; break outer; }
      }
    }
  }
  const spawnY = spawn.y;
  player.position.set(spawn.x + 0.5, spawnY, spawn.z + 0.5); // block-centered: AABB stays in one column

  // first impression: face the longest unobstructed eye-level sightline
  {
    let bestYaw = 0, bestScore = -1;
    for (let a = 0; a < 8; a++) {
      const yaw = a * Math.PI / 4;
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      let score = 0;
      for (let d = 1; d <= 14; d++) {
        const bx = Math.floor(spawn.x + 0.5 + dx * d);
        const bz = Math.floor(spawn.z + 0.5 + dz * d);
        if (world.isSolid(bx, spawnY + 1, bz) || world.getBlock(bx, spawnY + 2, bz) !== 0) break;
        score = d;
      }
      if (score > bestScore) { bestScore = score; bestYaw = yaw; }
    }
    player._yaw = bestYaw;
  }

  loadChunksAround(player.position.x, player.position.z);

  const { npcs, seaText } = initNPCs(world, renderer.scene, spawn.x, spawn.z);
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
    if (['q-talk', 'q-break', 'q-bag', 'q-place', 'q-sea', 'q-dinos'].every(q => questState[q])) {
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
    if (d.startsWith?.('talk:')) {
      const who = d.slice(5);
      if (HERD_NAMES.includes(who)) {
        questState['dino:' + who] = true;
        localStorage.setItem('blocktopia-quests', JSON.stringify(questState));
        const met = HERD_NAMES.filter(n => questState['dino:' + n]).length;
        const li = document.getElementById('q-dinos');
        if (li) {
          li.textContent = met === HERD_NAMES.length
            ? `Reunite Blaze's herd (6/6 — herd reunited!)`
            : `Reunite Blaze's herd (${met}/${HERD_NAMES.length} dinos met)`;
        }
        if (met === HERD_NAMES.length) markQuest('q-dinos');
      }
    }
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
      const gp = r.group.position;
      const lagXZ = Math.hypot(r.target.x - gp.x, r.target.z - gp.z);
      gp.x += (r.target.x - gp.x) * Math.min(1, dt * 10);
      gp.y += (r.target.y - gp.y) * Math.min(1, dt * 10);
      gp.z += (r.target.z - gp.z) * Math.min(1, dt * 10);
      r.group.rotation.y = r.target.yaw;
      if (r.anim) {
        r.anim.play(lagXZ > 0.15 ? 'Walk' : 'Idle');
        r.anim.update(dt);
      }
    }

    // Safety: respawn if player falls through the world
    if (player.position.y < -20) {
      player.position.set(spawn.x + 0.5, spawnY, spawn.z + 0.5); // block-centered: AABB stays in one column
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
