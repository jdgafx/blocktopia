import * as THREE from 'three';
import { initTouchControls } from '../src/game/touch.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Player } from '../src/game/player.js';

afterEach(() => vi.unstubAllGlobals());
describe('player menu controls', () => {
  it('pauses all held input without moving or mutating the world', () => {
    const elements = new Map();
    vi.stubGlobal('document', { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { focus: vi.fn() });
      return elements.get(id);
    }});
    const player = Object.create(Player.prototype);
    Object.assign(player, { _keys: { KeyW: true }, _breaking: true, _placing: true,
      touchMove: { x: 1, z: 1 }, touchJump: true, touchBreak: true, touchPlace: true,
      _physics: { update: vi.fn() }, _updateCamera: vi.fn(), _handleBlockInteraction: vi.fn() });
    player.setActive(false);
    player.update(0.1);
    expect(player._keys).toEqual({});
    expect(player.touchMove).toEqual({ x: 0, z: 0 });
    expect(player._placing || player._breaking || player.touchJump || player.touchBreak || player.touchPlace).toBe(false);
    expect(player._physics.update).not.toHaveBeenCalled();
    expect(player._handleBlockInteraction).not.toHaveBeenCalled();
    expect(elements.get('room-gate').hidden).toBe(false);
    player.setActive(true);
    expect(elements.get('room-gate').hidden).toBe(true);
  });
  it('selects only existing block slots', () => {
    const player = Object.create(Player.prototype);
    Object.assign(player, { hotbar: [1, 2, 3], hotbarIdx: 0, _updateHotbarUI: vi.fn() });
    player.selectBlock(2);
    expect(player.hotbarIdx).toBe(2);
    for (const value of [-1, 3, 0.5, '1', NaN]) player.selectBlock(value);
    expect(player.hotbarIdx).toBe(2);
    expect(player._updateHotbarUI).toHaveBeenCalledTimes(1);
  });
});

// Real Player event handlers and voxel raycasts; only browser event surfaces are supplied.
function controls(touchPoints = 0) {
  const surface = () => {
    const listeners = new Map();
    return { style: {}, focus: vi.fn(),
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      emit(type, event = {}) {
        for (const listener of listeners.get(type) ?? []) listener({ preventDefault() {}, target: this, ...event });
      },
    };
  };
  const elements = new Map();
  const document = Object.assign(surface(), { pointerLockElement: null,
    getElementById(id) { if (!elements.has(id)) elements.set(id, surface()); return elements.get(id); },
    querySelectorAll: () => [],
  });
  const window = Object.assign(surface(), { matchMedia: () => ({ matches: false }), innerWidth: 1200 });
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', { maxTouchPoints: touchPoints });
  const canvas = document.getElementById('canvas');
  canvas.requestPointerLock = vi.fn(async () => {
    document.pointerLockElement = canvas; document.emit('pointerlockchange');
  });
  const blocks = new Map([['0,1,-2', 4]]);
  const world = { getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0, isSolid: () => false };
  const camera = new THREE.PerspectiveCamera();
  const player = new Player(world, camera);
  player.position.set(0.5, 0, 0.5); player._updateCamera();
  player._onBlockIntent = vi.fn();
  return { player, document, canvas, elements, blocks };
}

describe('mouse and touch block interaction', () => {
  it('keeps the cursor available and separates right-drag looking from click placement', () => {
    const { player, document, canvas } = controls();
    player.mouseMode = 'cursor';
    document.getElementById('click-to-play').emit('click', { pointerType: 'mouse' });
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    document.emit('mousedown', { target: canvas, button: 2 });
    document.emit('mousemove', { target: canvas, movementX: 15, movementY: 0 });
    document.emit('mouseup', { target: canvas, button: 2 });
    player._handleBlockInteraction(.016);
    expect(player._yaw).toBeCloseTo(-.03);
    expect(player._onBlockIntent).not.toHaveBeenCalled();
    player._yaw = 0; player._updateCamera();
    document.emit('mousedown', { target: canvas, button: 2 });
    document.emit('mouseup', { target: canvas, button: 2 });
    player._handleBlockInteraction(.016);
    expect(player._onBlockIntent).toHaveBeenCalledOnce();
    document.getElementById('game-menu').emit('click');
    expect(player.active).toBe(false);
    expect(player._cursorLook).toBeNull();
  });
  it.each([0, 5])('captures a real mouse Play click with %s touch points and chops only from the canvas', (touchPoints) => {
    const { player, document, canvas } = controls(touchPoints);
    document.getElementById('click-to-play').emit('click', { pointerType: 'mouse' });
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(player.active).toBe(true);
    document.emit('mousedown', { target: document.getElementById('game-menu'), button: 0 });
    player._handleBlockInteraction(0.31);
    expect(player._onBlockIntent).not.toHaveBeenCalled();
    document.emit('mousedown', { target: canvas, button: 0 });
    player._handleBlockInteraction(0.15);
    expect(player.breakProgress).toBeCloseTo(0.5);
    expect(player.isSwinging).toBe(true);
    player._handleBlockInteraction(0.15);
    expect(player._onBlockIntent).toHaveBeenCalledWith({ x: 0, y: 1, z: -2, blockId: 0 });
  });

  it('switches from touch Play to mouse chopping before asynchronous capture completes', () => {
    const { player, document, canvas } = controls(5);
    document.getElementById('click-to-play').emit('click', { pointerType: 'touch' });
    expect(player.active).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    canvas.requestPointerLock.mockImplementation(() => new Promise(() => {}));
    document.emit('mousedown', { target: canvas, button: 0 });
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    player._handleBlockInteraction(0.3);
    expect(player._onBlockIntent).toHaveBeenCalledOnce();
    document.emit('mousemove', { target: canvas, movementX: 10, movementY: 0 });
    expect(player._yaw).toBeCloseTo(-0.02);
  });

  it('resets chopping progress on target changes and on release', () => {
    const { player, blocks } = controls(); player.setActive(true);
    player.beginInteraction('break'); player._handleBlockInteraction(0.2);
    expect(player.breakProgress).toBeCloseTo(2 / 3);
    blocks.delete('0,1,-2'); blocks.set('0,1,-3', 4);
    player._handleBlockInteraction(0.15);
    expect(player._onBlockIntent).not.toHaveBeenCalled();
    expect(player.breakProgress).toBeCloseTo(0.5);
    player._handleBlockInteraction(0.15);
    expect(player._onBlockIntent).toHaveBeenCalledWith({ x: 0, y: 1, z: -3, blockId: 0 });
    player._handleBlockInteraction(0.1); player.endInteraction('break');
    expect(player.breakProgress).toBe(0);
  });

  it('retains mouse placement and touch button taps occurring entirely between frames', () => {
    const { player, document, canvas } = controls(5);
    player.setActive(true); initTouchControls(player);
    document.emit('mousedown', { target: canvas, button: 2 });
    document.emit('mouseup', { target: canvas, button: 2 });
    player._handleBlockInteraction(0.016);
    expect(player._onBlockIntent).toHaveBeenCalledTimes(1);
    expect(player._onBlockIntent).toHaveBeenLastCalledWith({ x: 0, y: 1, z: -1, blockId: player.hotbar[0] });
    const place = document.getElementById('btn-place');
    place.emit('touchstart'); place.emit('touchend'); player._handleBlockInteraction(0.016);
    expect(player._onBlockIntent).toHaveBeenCalledTimes(2);
    player._handleBlockInteraction(0.016); expect(player._onBlockIntent).toHaveBeenCalledTimes(2);
    const swing = player.interactionSwing;
    const chop = document.getElementById('btn-break'); chop.emit('touchstart'); chop.emit('touchend');
    player._handleBlockInteraction(0.016);
    expect(player.interactionSwing).toBeGreaterThan(swing);
    expect(player.isSwinging).toBe(true); expect(player.breakProgress).toBeGreaterThan(0);
    player._handleBlockInteraction(0.016); expect(player.breakProgress).toBe(0);
    place.emit('touchstart'); player.setActive(false); player._handleBlockInteraction(0.016);
    expect(player._onBlockIntent).toHaveBeenCalledTimes(2);
    expect(player.isSwinging).toBe(false);
  });
});

describe('pointer capture refusal recovery', () => {
  it('keeps desktop drag-look and chopping playable when capture is refused, then clears the hint on success', async () => {
    const { player, document, canvas } = controls();
    const capture = canvas.requestPointerLock.getMockImplementation();
    canvas.requestPointerLock.mockRejectedValue(new Error('Capture denied'));
    await player._requestMouseCapture();
    expect(player.active).toBe(true);
    expect(document.pointerLockElement).toBeNull();
    expect(document.getElementById('input-hint').textContent).toContain('Mouse capture unavailable');
    document.emit('mousedown', { target: canvas, button: 0 });
    await Promise.resolve();
    expect(player._breaking).toBe(true);
    player._handleBlockInteraction(0.3);
    expect(player._onBlockIntent).toHaveBeenCalledWith({ x: 0, y: 1, z: -2, blockId: 0 });
    document.emit('mousemove', { target: canvas, movementX: 10, movementY: 4 });
    expect(player._yaw).toBeCloseTo(-0.02); expect(player._pitch).toBeCloseTo(-0.008);
    canvas.requestPointerLock.mockImplementation(capture);
    await player._requestMouseCapture();
    expect(document.pointerLockElement).toBe(canvas);
    expect(document.getElementById('input-hint').textContent).toBe('');
  });

  it.each(['menu', 'escape'])('does not resume after %s cancels a pending capture request', async (pause) => {
    const { player, document, canvas } = controls();
    let reject;
    canvas.requestPointerLock.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const request = player._requestMouseCapture();
    if (pause === 'menu') document.getElementById('game-menu').emit('click');
    else document.emit('keydown', { code: 'Escape' });
    reject(new Error('Capture denied')); await request;
    expect(player.active).toBe(false);
    expect(document.getElementById('room-gate').hidden).toBe(false);
    expect(document.getElementById('play-instruction').textContent).toBe('Resume playing');
    document.exitPointerLock = vi.fn();
    document.pointerLockElement = canvas; document.emit('pointerlockchange');
    expect(document.exitPointerLock).toHaveBeenCalledOnce();
    expect(player.active).toBe(false);
  });
});

describe('kinetic feedback', () => {
  it('emits face-aware immediate hit feedback before the authoritative block break', () => {
    const { player } = controls();
    player.setActive(true);
    player.beginInteraction('break');
    player._handleBlockInteraction(.016);
    expect(player.blockHit).toMatchObject({ x: 0, y: 1, z: -2, blockId: 4, face: [0, 0, 1], sequence: 1 });
    expect(player._onBlockIntent).not.toHaveBeenCalled();
    const sequence = player.blockHit.sequence;
    player._handleBlockInteraction(.016);
    expect(player.blockHit.sequence).toBe(sequence);
    player._handleBlockInteraction(.08);
    expect(player.blockHit.sequence).toBeGreaterThan(sequence);
    player.setActive(false);
    expect(player.blockHit).toBeNull();
  });
  it('smooths a small grounded bob and settles exactly toward the eye height when stopped', () => {
    const { player } = controls();
    player.setActive(true); player._physics.onGround = true;
    player._moveDir = { x: 1, z: 0 };
    player._updateCamera(.016);
    const bob = player._camera.position.y - player.position.y - 1.6;
    expect(bob).toBeGreaterThan(0); expect(bob).toBeLessThan(.025);
    player._moveDir = { x: 0, z: 0 };
    for (let i = 0; i < 60; i++) player._updateCamera(.016);
    expect(player._camera.position.y).toBeCloseTo(player.position.y + 1.6, 6);
  });
});

it.each(['keyboard', 'touch'])('retains a complete %s jump tap between frames and consumes it only once', input => {
  const { player, document } = controls(5);
  initTouchControls(player); player.setActive(true);
  player._physics.onGround = true;
  const startY = player.position.y;
  const press = () => {
    if (input === 'keyboard') document.emit('keydown', { code: 'Space' });
    else document.getElementById('btn-jump').emit('touchstart');
  };
  const release = () => {
    if (input === 'keyboard') document.emit('keyup', { code: 'Space' });
    else document.getElementById('btn-jump').emit('touchend');
  };
  press(); release();
  expect(player._keys.Space || player.touchJump).toBeFalsy();
  player.update(.016);
  expect(player.position.y).toBeGreaterThan(startY);
  expect(player._physics._vy).toBeGreaterThan(0);
  expect(player._jumpQueued).toBe(false);
  const velocity = player._physics._vy;
  player.update(.016);
  expect(player._physics._vy).toBeLessThan(velocity);
  press(); player.setActive(false); player.setActive(true);
  expect(player._jumpQueued).toBe(false);
});
