import * as THREE from 'three';
import { SOCIAL_EMOTES, SOCIAL_PINGS } from '../network/protocol.js';

// Same 64x64 flat pictogram style and .menu-icon markup as src/ui/icons.js. Only these built-in drawings are ever shown.
const drawings = {
  wave: '<rect x="18" y="30" width="28" height="26" rx="10" fill="#f0c98c"/><g fill="#f0c98c"><rect x="18" y="12" width="7" height="26" rx="3.5"/><rect x="27" y="8" width="7" height="30" rx="3.5"/><rect x="36" y="12" width="7" height="26" rx="3.5"/><rect x="45" y="20" width="7" height="22" rx="3.5"/></g><path d="M8 20c-3 5-3 11 0 16M56 10c4 4 5 9 3 14" fill="none" stroke="#e9a35f" stroke-width="3" stroke-linecap="round"/>',
  love: '<path fill="#e0627a" d="M32 56C10 40 6 26 12 18c6-8 16-5 20 3 4-8 14-11 20-3 6 8 2 22-20 38Z"/><path d="M17 22c2-4 6-4 9-1" fill="none" stroke="#f7a9b6" stroke-width="3" stroke-linecap="round"/>',
  sit: '<g fill="#b98550"><rect x="16" y="8" width="8" height="34" rx="3"/><rect x="16" y="34" width="32" height="9" rx="3"/><rect x="16" y="42" width="7" height="16" rx="2"/><rect x="41" y="42" width="7" height="16" rx="2"/></g>',
  cheer: '<path fill="#f2c94c" d="m32 6 7 17 18 1-14 12 5 18-16-10-16 10 5-18L7 24l18-1Z"/><path d="M8 8l5 5m43-5-5 5M32 1v4" stroke="#e9a35f" stroke-width="3" stroke-linecap="round"/>',
  laugh: '<circle cx="32" cy="32" r="25" fill="#f2c94c"/><path d="M16 26q5-6 10 0M38 26q5-6 10 0" stroke="#5b3a14" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M15 36h34c0 13-8 19-17 19S15 49 15 36Z" fill="#7a2f2f"/><path d="M20 40h24" stroke="#fff" stroke-width="4"/><path d="M24 50c4-4 12-4 16 0" stroke="#e0627a" stroke-width="4" fill="none"/>',
  dance: '<ellipse cx="22" cy="48" rx="9" ry="7" fill="#7aa8d8"/><ellipse cx="46" cy="42" rx="9" ry="7" fill="#7aa8d8"/><path d="M29 48V14l24-6v34" fill="none" stroke="#7aa8d8" stroke-width="5"/><path d="M29 22l24-6" stroke="#7aa8d8" stroke-width="6"/>',
  come: '<circle cx="32" cy="32" r="8" fill="#e9b44c"/><circle cx="32" cy="32" r="18" fill="none" stroke="#e9b44c" stroke-width="4"/><path d="M4 32h12m-5-6 6 6-6 6M60 32H48m5-6-6 6 6 6" fill="none" stroke="#97c7a0" stroke-width="4" stroke-linecap="round"/>',
  look: '<path d="M4 32C14 16 50 16 60 32 50 48 14 48 4 32Z" fill="#f4ecd8"/><circle cx="32" cy="32" r="11" fill="#4f896d"/><circle cx="32" cy="32" r="5" fill="#173226"/><circle cx="36" cy="28" r="2.5" fill="#fff"/>',
  help: '<circle cx="32" cy="32" r="26" fill="#d9534f"/><path d="M32 14v22" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="47" r="4.5" fill="#fff"/>',
  quiet: '<path d="M32 8c-9 0-15 7-15 16 0 12-6 14-6 20h42c0-6-6-8-6-20 0-9-6-16-15-16Z" fill="#c9b27c"/><circle cx="32" cy="52" r="5" fill="#c9b27c"/><path d="M10 10l44 44" stroke="#d9534f" stroke-width="6" stroke-linecap="round"/>',
};
const LABELS = { wave: 'Wave', love: 'Love', sit: 'Sit', cheer: 'Cheer', laugh: 'Laugh', dance: 'Dance', come: 'Come', look: 'Look', help: 'Help' };
const glyph = (name) => `<svg class="menu-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${drawings[name]}</svg>`;

const EMOTE_MS = 3200, FADE_MS = 800, PING_MS = 5000, FLOOD_MS = 150, MAX_SEEN = 40, QUIET_KEY = 'blocktopia-quiet';
const $ = (id) => document.getElementById(id);

// Wheel, quiet switch, emote/ping sprites and locator dots. Messages arrive already checked by parseSocial.
export function initEmotes(session, player, renderer, { diagnostics = false } = {}) {
  const wheel = $('emote-wheel'), openButton = $('open-emotes'), hud = $('hud');
  let quiet = false;
  try { quiet = localStorage.getItem(QUIET_KEY) === '1'; } catch {}
  const live = new Map(), lastAt = new Map(), dots = new Map(), textures = new Map(), seen = [];
  const scratch = new THREE.Vector3();

  const texture = (kind, id) => {
    const key = `${kind}:${id}`;
    if (textures.has(key)) return textures.get(key);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    const image = new Image();
    image.onload = () => { canvas.getContext('2d').drawImage(image, 0, 0, 128, 128); map.needsUpdate = true; };
    image.src = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#14231e" fill-opacity=".88" stroke="${kind === 'ping' ? '#e9b44c' : '#f4ecd8'}" stroke-width="3"/><g transform="translate(9.6 9.6) scale(.7)">${drawings[id]}</g></svg>`)}`;
    textures.set(key, map);
    return map;
  };
  for (const id of SOCIAL_EMOTES) texture('emote', id);
  for (const id of SOCIAL_PINGS) texture('ping', id);

  function drop(key) {
    const entry = live.get(key);
    if (!entry) return;
    renderer.scene.remove(entry.sprite); entry.sprite.material.dispose(); live.delete(key);
  }
  function show({ from, kind, id }) {
    const state = session.remoteStates.get(from);
    if (!state) return;
    const ping = kind === 'ping', key = `${from}:${kind}`;
    drop(key);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(kind, id), transparent: true, depthTest: !ping, depthWrite: false }));
    sprite.scale.setScalar(ping ? 1.6 : 1.1); sprite.renderOrder = 10;
    sprite.position.set(state.position[0], state.position[1] + (ping ? 1.2 : 2.4), state.position[2]);
    renderer.scene.add(sprite);
    live.set(key, { sprite, from, ping, born: performance.now(), life: ping ? PING_MS : EMOTE_MS });
    seen.push({ from, kind, id, at: Date.now(), position: sprite.position.toArray(), meshId: sprite.uuid });
    if (seen.length > MAX_SEEN) seen.shift();
  }
  function receive(message) {
    const now = performance.now();
    if (quiet || now - (lastAt.get(message.from) ?? -Infinity) < FLOOD_MS) return;
    lastAt.set(message.from, now);
    show(message);
  }

  function setQuiet(value) {
    quiet = value;
    try { localStorage.setItem(QUIET_KEY, value ? '1' : '0'); } catch {}
    for (const key of [...live.keys()]) drop(key);
    const button = wheel.querySelector('[data-quiet]');
    button.setAttribute('aria-pressed', String(quiet));
    button.querySelector('span').textContent = quiet ? 'Quiet on' : 'Quiet off';
  }

  // The wheel pauses play like the other panels do and gives play back when it closes.
  let resume = false;
  function open() {
    if (!wheel.hidden) return;
    resume = player.active; document.exitPointerLock?.();
    if (player.active) player.setActive(false);
    document.body.classList.add('emote-open'); wheel.hidden = false; openButton.setAttribute('aria-expanded', 'true');
    wheel.querySelector('[data-emote]').focus({ preventScroll: true });
  }
  function close() {
    if (wheel.hidden) return;
    wheel.hidden = true; document.body.classList.remove('emote-open'); openButton.setAttribute('aria-expanded', 'false');
    if (!resume) return;
    resume = false;
    if (matchMedia('(pointer: coarse)').matches || player.mouseMode === 'cursor') player.setActive(true);
    else player._requestMouseCapture();
  }

  const button = (attr, name, label) => `<button type="button" ${attr}="${name}" title="${label}">${glyph(name)}<span>${label}</span></button>`;
  wheel.innerHTML = `<div class="emote-card"><div class="emote-grid">${
    SOCIAL_EMOTES.map((id) => button('data-emote', id, LABELS[id])).join('')}${
    SOCIAL_PINGS.map((id) => button('data-ping', id, LABELS[id])).join('')}</div>
    <button type="button" data-quiet aria-pressed="false" title="Hide other players' emotes and pings on this screen only">${glyph('quiet')}<span>Quiet off</span></button></div>`;
  openButton.innerHTML = `${glyph('laugh')}<span>Emotes · G</span>`; openButton.classList.add('illustrated-control');
  setQuiet(quiet);

  openButton.addEventListener('click', () => (wheel.hidden ? open() : close()));
  wheel.addEventListener('click', (event) => {
    const target = event.target.closest?.('button');
    if (!target) { if (event.target === wheel) close(); return; }
    if (target.hasAttribute('data-quiet')) return setQuiet(!quiet);
    const kind = target.hasAttribute('data-ping') ? 'ping' : 'emote';
    session.sendSocial(kind, target.getAttribute(kind === 'ping' ? 'data-ping' : 'data-emote'));
    close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.target.closest?.('input, textarea, select')) return;
    if (event.code === 'Escape' && !wheel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.code === 'KeyG' && !event.repeat && (!wheel.hidden || player.active)) { event.preventDefault(); wheel.hidden ? open() : close(); }
  }, true);

  function update(now) {
    for (const [key, entry] of live) {
      const age = now - entry.born;
      if (age >= entry.life) { drop(key); continue; }
      entry.sprite.material.opacity = Math.min(1, (entry.life - age) / FADE_MS);
      const state = session.remoteStates.get(entry.from);
      if (!entry.ping && state) entry.sprite.position.set(state.position[0], state.position[1] + 2.4, state.position[2]);
    }
    const ids = new Set();
    for (const { playerId } of session.members) {
      if (playerId === session.playerId) continue;
      ids.add(playerId);
      let dot = dots.get(playerId);
      if (!dot) {
        dot = document.createElement('i'); dot.className = 'locator'; dot.dataset.locator = playerId;
        let hue = 0; for (const c of playerId) hue = (hue * 31 + c.charCodeAt(0)) % 360;
        dot.style.background = `hsl(${hue} 80% 60%)`; hud.append(dot); dots.set(playerId, dot);
      }
      const state = session.remoteStates.get(playerId);
      if (!state || now - state.at > 10000) { dot.hidden = true; continue; }
      scratch.set(state.position[0], state.position[1] + 1, state.position[2]).project(renderer.camera);
      if (scratch.z > 1) { scratch.x = -scratch.x; scratch.y = -scratch.y; } // behind the camera: point the other way
      const edge = Math.max(1, Math.abs(scratch.x) / 0.9, Math.abs(scratch.y) / 0.8);
      dot.style.left = `${(scratch.x / edge * 0.5 + 0.5) * innerWidth}px`;
      dot.style.top = `${(-scratch.y / edge * 0.5 + 0.5) * innerHeight}px`;
      dot.hidden = false;
    }
    for (const [id, dot] of dots) if (!ids.has(id)) { dot.remove(); dots.delete(id); }
  }

  if (diagnostics) {
    window.__SOCIAL_DIAGNOSTICS__ = {
      get me() { return session.playerId; }, get quiet() { return quiet; }, get seen() { return seen.map((entry) => ({ ...entry })); },
      sendRaw: (payload) => session._broadcast('social', payload),
    };
  }
  return { receive, update };
}
