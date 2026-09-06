import { decorateMenus } from './ui/icons.js';
import './ui/menus.css';
import { DefaultLoadingManager } from 'three';
import { hostedAssetUrl } from './engine/asset-urls.js';
import { CreatureSession } from './network/creature-session.js';
import { CreatureVisuals } from './game/creature-visuals.js';
import { CreatureAudio } from './game/creature-audio.js';
import { initCreatureUI } from './ui/creatures.js';
import { World, CHUNK_H } from './engine/world.js';
import { Renderer } from './engine/renderer.js';
import { Player } from './game/player.js';
import { initTouchControls } from './game/touch.js';
import { initHUD } from './ui/hud.js';
import { ITEM_IDS } from './game/camp.js';
import { initExpeditions } from './ui/expeditions.js';
import { initCampUI } from './ui/camp.js';
import { Characters } from './game/characters.js';
import { FirstPerson } from './game/first-person.js';
import { initAdventure } from './ui/adventure.js';
import { initAccount } from './ui/account.js';
import { MultiplayerSession } from './network/session.js';

DefaultLoadingManager.setURLModifier(url => hostedAssetUrl(url, location.hostname));

let renderDistance = 4;
decorateMenus();

const lobby = document.getElementById('room-lobby');
const playGate = document.getElementById('play-gate');
const lobbyStatus = document.getElementById('lobby-status');
const createButton = document.getElementById('create-room');
const joinButton = document.getElementById('join-room');
const roomInput = document.getElementById('room-code');
const networkStatus = document.getElementById('network-status');

for (const destination of document.querySelectorAll('[data-controls-copy]')) {
  destination.append(document.getElementById('controls-directions').content.cloneNode(true));
}
let mouseMode = 'capture';
try { if (localStorage.getItem('blocktopia-mouse-mode') === 'cursor') mouseMode = 'cursor'; } catch {}
const mouseSelectors = [...document.querySelectorAll('[data-mouse-mode]')];
for (const selector of mouseSelectors) {
  selector.value = mouseMode;
  selector.addEventListener('change', () => {
    mouseMode = selector.value;
    for (const other of mouseSelectors) other.value = mouseMode;
    try { localStorage.setItem('blocktopia-mouse-mode', mouseMode); } catch {}
    window.dispatchEvent(new CustomEvent('game-mouse-mode', { detail: mouseMode }));
  });
}
const controlsOverlay = document.getElementById('controls-overlay');
const controlsButton = document.getElementById('game-controls');
function showControls(show) {
  controlsOverlay.hidden = !show;
  controlsButton.setAttribute('aria-expanded', String(show));
}
controlsButton.addEventListener('click', () => showControls(controlsOverlay.hidden));
document.getElementById('hide-controls').addEventListener('click', () => showControls(false));
document.addEventListener('keydown', event => {
  if (event.code !== 'KeyH' || event.repeat || event.target.closest?.('input, textarea, select')
    || document.getElementById('hud').hidden) return;
  event.preventDefault(); showControls(controlsOverlay.hidden);
});

let world;
let renderer;
let player;
let remeshAt;
let refreshCamp;
let refreshWorld;
let adventure;
let firstPerson;
let creatureUI;
let creatureDirtyAt = 0;
let lastNetwork = { roomCode: '', role: '', playerCount: 0, icePath: 'connecting' };
const pendingMutations = [];

const session = new MultiplayerSession({
  worldHeight: CHUNK_H,
  allowedBlockIds: new Set([0, ...ITEM_IDS]),
  isPlaying: () => player?.active === true,
  onCreatures: () => {
    if (performance.now() > creatureDirtyAt) { creatureDirtyAt = performance.now() + 5000; expeditions.markDirty(); }
  },
  getLocalState: () => player && ({ position: player.position.toArray(), yaw: player._yaw, pitch: player._pitch }),
  getBlock: (x, y, z) => world?.getBlock(x, y, z),
  getTreeBlocks: (x, y, z) => world?.getTreeBlocks(x, y, z) ?? [],
  applyMutation: (commit) => {
    if (!world) {
      pendingMutations.push(commit);
      return;
    }
    if (!commit.kind || commit.kind === 'block') {
      if (commit.blockId === 0 && !commit.treeFall && session.snapshotReady) firstPerson?.impact(commit.x, commit.y, commit.z, world.getBlock(commit.x, commit.y, commit.z));
      world.setBlock(commit.x, commit.y, commit.z, commit.blockId);
      if (session.snapshotReady) remeshAt(commit.x, commit.y, commit.z);
    }
    if (session.snapshotReady && !commit.treeFall) { refreshCamp?.(); adventure?.refresh(); expeditions.markDirty(); }
  },
  onSnapshot: () => {
    refreshWorld?.(); refreshCamp?.(); adventure?.refresh(); expeditions.markDirty();
    if (player && world.isSolid(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z))) {
      for (let y = CHUNK_H - 1; y >= 0; y--) {
        if (world.isSolid(Math.floor(player.position.x), y, Math.floor(player.position.z))) { player.position.y = y + 2; break; }
      }
    }
  },
  onRejected: (reason) => {
    creatureUI?.reject(reason);
    document.getElementById('story-feedback').textContent = reason;
    document.getElementById('camp-feedback').textContent = reason;
    document.getElementById('menu-status').textContent = reason;
  },
  onMovement: (id, sample) => renderer?.updateRemotePlayer(id, sample),
  onPeerLeft: (id) => renderer?.removeRemotePlayer(id),
  onPlayers: (members) => {
    renderer?.retainRemotePlayers(new Set(members.map((member) => member.playerId).filter((id) => id !== session.playerId)));
    lastNetwork.playerCount = members.length;
    renderNetworkStatus();
  },
  onStatus: (status) => {
    lastNetwork = { ...lastNetwork, ...status };
    lobbyStatus.textContent = status.message;
    lobbyStatus.dataset.state = status.state;
    if (status.state === 'connecting' && world) document.getElementById('menu-status').textContent = status.message;
    const busy = status.state === 'connecting';
    createButton.disabled = busy || Boolean(session.configurationError);
    joinButton.disabled = busy || Boolean(session.configurationError);
    renderNetworkStatus();
  },
  onReady: (room) => startGame(room),
});

if (session.configurationError) {
  lobbyStatus.textContent = session.configurationError;
  lobbyStatus.dataset.state = 'config-missing';
  createButton.disabled = true;
  joinButton.disabled = true;
}

const expeditions = initExpeditions(session.supabase, {
  open: (saved) => session.createRoom({ seed: saved.seed, mode: saved.mode, generation: saved.snapshot.generation ?? 1, snapshot: saved.snapshot }),
  getSnapshot: () => session.ledger.snapshot(),
  canSave: () => session.snapshotReady,
});
const accountPanel = document.getElementById('account-panel');
const account = initAccount(session.supabase, {
  onChange: (user) => {
    if (!user && world) {
      if (!expeditions.prepareReload()) {
        document.getElementById('menu-status').textContent = 'Sign-in expired and browser backup failed. Keep this tab open to preserve your world.';
        return;
      }
      session.destroy().finally(() => location.replace(location.pathname)); return;
    }
    expeditions.setUser(user);
    accountPanel.hidden = Boolean(user);
    lobby.hidden = !user || Boolean(world);
    document.getElementById('account-name').textContent = user ? `Signed in as ${user.email}` : '';
  },
});
const invitedRoom = new URL(location.href).searchParams.get('room');
if (invitedRoom) roomInput.value = invitedRoom.slice(0, 7);
createButton.addEventListener('click', () => { if (account.user) session.createRoom({ mode: document.getElementById('world-mode').value }).catch(showConnectionError); });
document.getElementById('sign-out').addEventListener('click', async () => {
  try { await account.signOut(); } catch { lobbyStatus.textContent = 'Could not sign out. Please try again.'; }
});
document.getElementById('copy-invite').addEventListener('click', async () => {
  const input = document.getElementById('invite-url');
  try {
    await navigator.clipboard.writeText(input.value);
    document.getElementById('menu-status').textContent = 'Invite link copied. Send it to a friend.';
  } catch {
    input.focus(); input.select();
    document.getElementById('menu-status').textContent = 'Select and copy the invite link above.';
  }
});
document.getElementById('leave-room').addEventListener('click', async () => {
  try {
    await expeditions.flush();
    await session.destroy();
    location.replace(location.pathname);
  } catch (error) { document.getElementById('menu-status').textContent = `${error.message} Stay here and retry Save.`; }
});
document.getElementById('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!account.user) return;
  session.joinRoom(roomInput.value).catch(showConnectionError);
});
window.addEventListener('pagehide', () => session.destroy());

function showConnectionError() {
  lobbyStatus.textContent = 'Could not connect to the room service.';
  lobbyStatus.dataset.state = 'connection-error';
  createButton.disabled = false;
  joinButton.disabled = false;
}

function renderNetworkStatus() {
  if (!networkStatus || !lastNetwork.roomCode) return;
  const role = lastNetwork.role === 'host' ? 'Host' : 'Guest';
  const count = lastNetwork.playerCount || 1;
  const failure = lastNetwork.state === 'rtc-failure' ? ` | RTC failure: ${lastNetwork.message}` : '';
  networkStatus.textContent = `Room ${lastNetwork.roomCode} · ${count} player${count === 1 ? '' : 's'}${lastNetwork.state === 'connecting' ? ' · Reconnecting…' : failure ? ' · Connection interrupted' : count > 1 && lastNetwork.icePath === 'connecting' ? ' · Connecting players…' : ''}`;
  networkStatus.title = `${role} | WebRTC ${lastNetwork.icePath}${failure}`;
}

function startGame(room) {
  if (world) return;
  world = new World(room.seed, room.generation ?? 1);
  renderer = new Renderer(document.getElementById('canvas'), renderDistance);
  const lightingControl = document.getElementById('scene-lighting');
  const brightnessControl = document.getElementById('scene-brightness');
  try {
    const saved = JSON.parse(localStorage.getItem('blocktopia-lighting'));
    if (['daylight', 'cycle'].includes(saved?.mode)) lightingControl.value = saved.mode;
    if (Number.isFinite(saved?.brightness) && saved.brightness >= 80 && saved.brightness <= 175) brightnessControl.value = saved.brightness;
  } catch {}
  const applyLighting = () => {
    const brightness = Number(brightnessControl.value);
    renderer.setLighting(lightingControl.value); renderer.setBrightness(brightness / 100);
    document.getElementById('scene-brightness-value').textContent = `${brightness}%`;
    try { localStorage.setItem('blocktopia-lighting', JSON.stringify({ mode: lightingControl.value, brightness })); } catch {}
  };
  lightingControl.addEventListener('change', applyLighting);
  brightnessControl.addEventListener('input', applyLighting);
  applyLighting();
  player = new Player(world, renderer.camera);
  firstPerson = new FirstPerson(renderer.camera, renderer.scene);
  const creatures = new CreatureVisuals(world, renderer.scene);
  const creatureAudio = new CreatureAudio();
  const creatureSystem = session.creatureSystem = new CreatureSession(session, world, account.user.id);
  creatureUI = initCreatureUI(session, player, creatures, world, account.user.id);
  const unlockCreatures = () => creatureAudio.unlock();
  document.addEventListener('pointerdown', unlockCreatures);
  window.addEventListener('pagehide', () => { creatureSystem.dispose(); creatures.dispose(); creatureAudio.dispose(); });
  const characters = world.generation >= 2 ? new Characters(world, renderer.scene, { ambientAnimals: false }) : null;
  if (characters) adventure = initAdventure(session, player, characters);
  for (const id of ['open-journal', 'region-name', 'story-objective']) document.getElementById(id).hidden = !characters;
  document.getElementById('camp-goal').hidden = Boolean(characters);
  initHUD(player);
  refreshCamp = initCampUI(session, player);
  refreshCamp();
  expeditions.begin(room);
  initTouchControls(player);
  document.getElementById('hud').hidden = false;
  lobby.hidden = true;
  const playButton = document.getElementById('click-to-play');
  const playInstruction = document.getElementById('play-instruction');
  playButton.disabled = true;
  playButton.title = 'Waiting for world textures to finish loading';
  playInstruction.textContent = 'Preparing the world…';
  playGate.hidden = false;
  const invite = new URL(location.href);
  invite.search = ''; invite.hash = ''; invite.searchParams.set('room', room.roomCode);
  history.replaceState(null, '', invite);
  document.getElementById('invite-url').value = invite.href;
  Promise.all([renderer._material.ready, renderer._vegetation.ready, characters?.animalSkins.ready, creatures.ready, creatureSystem.readyPromise]).then(() => {
    lastTime = performance.now();
    loop();
    document.getElementById('room-gate').classList.add('in-world');
    playInstruction.textContent = navigator.maxTouchPoints > 0 ? 'Tap to play' : 'Click to play';
    playButton.disabled = false;
    playButton.title = 'Enter the world and start exploring';
  }).catch((error) => {
    document.getElementById('menu-status').textContent = error?.message || 'World textures or creature ownership could not load. Reload to try again.';
    playInstruction.textContent = 'Reload world';
    playButton.title = 'Reload the page to retry loading world textures';
    playButton.disabled = false;
    playButton.addEventListener('click', event => {
      event.stopImmediatePropagation(); location.reload();
    }, { capture: true, once: true });
  });

  const changedChunks = new Set();
  let remeshQueued = false;
  function remeshChunk(cx, cz) {
    changedChunks.add(`${cx},${cz}`);
    if (remeshQueued) return;
    remeshQueued = true;
    queueMicrotask(() => {
      remeshQueued = false;
      for (const key of changedChunks) {
        const [x, z] = key.split(',').map(Number);
        if (renderer.hasChunk(x, z)) renderer.updateChunk(world.getChunk(x, z), world);
      }
      changedChunks.clear();
    });
  }

  remeshAt = (wx, wy, wz) => {
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;
    remeshChunk(cx, cz);
    if (lx === 0) remeshChunk(cx - 1, cz);
    if (lx === 15) remeshChunk(cx + 1, cz);
    if (lz === 0) remeshChunk(cx, cz - 1);
    if (lz === 15) remeshChunk(cx, cz + 1);
  };
  player._onBlockChanged = remeshAt;
  player._onBlockIntent = (intent) => session.submitMutation(intent);

  const spawnX = 8 + Math.min(session.joinOrder, 3) * 2;
  const spawnZ = world.generation >= 2 ? 12 : 8;
  let spawnY = 50;
  for (let y = 60; y > 0; y--) {
    if (world.getBlock(spawnX, y, spawnZ) !== 0) {
      spawnY = y + 2;
      break;
    }
  }
  player.position.set(spawnX, spawnY, spawnZ);
  renderer.camera.position.copy(player.position);
  renderer.camera.position.y += 1.6;

  let pendingChunks = [];
  let initialTerrainBuilt = false;
  function buildNextChunk() {
    const next = pendingChunks.shift();
    if (!next) return;
    const [cx, cz] = next;
    const chunk = world.getChunk(cx, cz);
    if (chunk.dirty || !renderer.hasChunk(cx, cz)) renderer.updateChunk(chunk, world);
  }
  function loadChunksAround(px, pz) {
    const cx = Math.floor(px / 16);
    const cz = Math.floor(pz / 16);
    const visible = new Set();
    const needed = [];
    for (let dx = -renderDistance; dx <= renderDistance; dx++) {
      for (let dz = -renderDistance; dz <= renderDistance; dz++) {
        const chunkX = cx + dx, chunkZ = cz + dz;
        visible.add(`${chunkX},${chunkZ}`);
        const chunk = world.chunks.get(`${chunkX},${chunkZ}`);
        if (!chunk || chunk.dirty || !renderer.hasChunk(chunkX, chunkZ)) needed.push([chunkX, chunkZ]);
      }
    }
    renderer.retainChunks(visible);
    world.retainAround(cx, cz, renderDistance + 1);
    pendingChunks = needed.sort((a, b) =>
      (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - (b[0] - cx) ** 2 - (b[1] - cz) ** 2);
    if (!initialTerrainBuilt) {
      // Populate the immediate spawn area before handing control to the player.
      for (let i = 0; i < 9; i++) buildNextChunk();
      initialTerrainBuilt = true;
    }
  }

  refreshWorld = () => loadChunksAround(player.position.x, player.position.z);
  document.getElementById('graphics-quality').addEventListener('change', event => {
    const quality = event.target.value;
    renderDistance = quality === 'high' ? 6 : 4;
    renderer.setQuality(quality); refreshWorld();
  });
  refreshWorld();
  for (const commit of pendingMutations.splice(0)) {
    if (commit.kind && commit.kind !== 'block') continue;
    world.setBlock(commit.x, commit.y, commit.z, commit.blockId);
    remeshAt(commit.x, commit.y, commit.z);
  }

  let lastCX = Math.floor(player.position.x / 16);
  let lastCZ = Math.floor(player.position.z / 16);
  let lastTime = performance.now();
  let nextHudAt = 0;
  const info = document.getElementById('info');
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;
    const dt = Math.min(elapsed, 0.05);
    lastTime = now;
    creatureSystem.tick(Math.min(elapsed, .5));
    creatures.update(dt, player.position, session.ledger.creatures);
    creatureUI.update(now);
    creatureAudio.update(dt, { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player._yaw }, session.ledger.creatures);
    player.update(dt);
    firstPerson.update(dt, player);
    characters?.update(dt, player.position, session.ledger.story?.stage ?? 0);
    adventure?.update(now);
    const cx = Math.floor(player.position.x / 16);
    const cz = Math.floor(player.position.z / 16);
    if (cx !== lastCX || cz !== lastCZ) {
      loadChunksAround(player.position.x, player.position.z);
      lastCX = cx;
      lastCZ = cz;
    }
    buildNextChunk();
    if (now >= nextHudAt) {
      nextHudAt = now + 250;
      const position = player.position;
      info.textContent = `XYZ ${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)} | FPS ${Math.round(1 / Math.max(elapsed, 0.001))}`;
    }
    renderer.render();
  }
}
