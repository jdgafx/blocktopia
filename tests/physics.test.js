import { describe, it, expect } from 'vitest';
import { Physics } from '../src/engine/physics.js';
import { BLOCKS } from '../src/constants/blocks.js';
import { World } from '../src/engine/world.js';

function solidWorld(solidFn) {
  return { isSolid: solidFn };
}

describe('Physics', () => {
  it('applies gravity when not on ground', () => {
    const world = solidWorld(() => false);
    const phys = new Physics(world);
    const pos = { x: 0, y: 10, z: 0 };
    phys.update(pos, { x: 0, z: 0 }, false, 0.1);
    expect(pos.y).toBeLessThan(10);
  });

  it('stops falling when it hits ground at y=0', () => {
    const world = solidWorld((x, y, z) => y < 0);
    const phys = new Physics(world);
    const pos = { x: 0.3, y: 0.0, z: 0.3 };
    phys._vy = -5;
    phys.update(pos, { x: 0, z: 0 }, false, 0.1);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(phys.onGround).toBe(true);
  });

  it('cannot move through a solid wall', () => {
    const world = solidWorld((x, y, z) => x >= 2);
    const phys = new Physics(world);
    const pos = { x: 1.1, y: 1, z: 0.3 };
    phys.onGround = true;
    phys._vy = 0;
    for (let i = 0; i < 20; i++) {
      phys.update(pos, { x: 1, z: 0 }, false, 0.1);
    }
    expect(pos.x).toBeLessThan(2);
  });

  it('jumps when on ground', () => {
    const world = solidWorld((x, y, z) => y < 0);
    const phys = new Physics(world);
    const pos = { x: 0.3, y: 0, z: 0.3 };
    phys.onGround = true;
    phys._vy = 0;
    phys.update(pos, { x: 0, z: 0 }, true, 0.1);
    expect(pos.y).toBeGreaterThan(0);
  });

  it('settles on a generated multi-voxel surface without sinking, then moves and jumps', () => {
    const world = new World(3266133468);
    const phys = new Physics(world);
    const pos = { x: 8, y: 21, z: 8 };

    for (let frame = 0; frame < 120; frame++) phys.update(pos, { x: 0, z: 0 }, false, 1 / 60);
    expect(pos.y).toBe(20);
    expect(phys.onGround).toBe(true);
    let lowestY = pos.y;
    for (let frame = 0; frame < 480; frame++) {
      phys.update(pos, { x: 0, z: 0 }, false, 1 / 60);
      lowestY = Math.min(lowestY, pos.y);
    }
    expect(lowestY).toBe(20);

    const startX = pos.x;
    let movedBackward = false;
    for (let frame = 0; frame < 60; frame++) {
      const previousX = pos.x;
      phys.update(pos, { x: 1, z: 0 }, false, 1 / 60);
      movedBackward ||= pos.x < previousX;
    }
    expect(pos.x).toBeGreaterThan(startX + 1);
    expect(movedBackward).toBe(false);
    expect(pos.y).toBeGreaterThanOrEqual(20);

    const jumpBase = pos.y;
    phys.update(pos, { x: 0, z: 0 }, true, 1 / 60);
    expect(pos.y).toBeGreaterThan(jumpBase);
    expect(phys.onGround).toBe(false);
  });
});

describe('forgiving kinematic jumps', () => {
  const idle = { x: 0, z: 0 };
  it('allows an 80ms ledge grace period but prevents a second midair jump', () => {
    const physics = new Physics(solidWorld(() => false));
    const position = { x: 0, y: 3, z: 0 };
    physics.onGround = true;
    physics.update(position, idle, false, .016);
    physics.update(position, idle, true, .06);
    expect(physics._vy).toBeGreaterThan(7);
    physics.update(position, idle, false, .016);
    const velocity = physics._vy;
    physics.update(position, idle, true, .016);
    expect(physics._vy).toBeLessThan(velocity);
  });
  it('rejects an expired ledge grace period', () => {
    const physics = new Physics(solidWorld(() => false));
    const position = { x: 0, y: 3, z: 0 };
    physics.onGround = true;
    physics.update(position, idle, false, .016);
    physics.update(position, idle, false, .09);
    physics.update(position, idle, true, .016);
    expect(physics._vy).toBeLessThan(0);
  });
  it('buffers a jump before landing and does not bounce again while held', () => {
    const physics = new Physics(solidWorld((x, y) => y < 0));
    const position = { x: 0, y: .08, z: 0 };
    physics._vy = -2;
    physics.update(position, idle, true, .016);
    expect(physics._vy).toBeLessThan(0);
    physics.update(position, idle, true, .016);
    physics.update(position, idle, true, .016);
    expect(physics._vy).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) physics.update(position, idle, true, .016);
    expect(position.y).toBe(0);
    expect(physics.onGround).toBe(true);
  });
  it('reverses air control promptly without instant velocity snapping', () => {
    const physics = new Physics(solidWorld(() => false));
    const position = { x: 0, y: 10, z: 0 };
    physics.update(position, { x: 1, z: 0 }, false, .016);
    expect(physics._vx).toBeCloseTo(.96);
    for (let i = 0; i < 6; i++) physics.update(position, { x: -1, z: 0 }, false, .016);
    expect(physics._vx).toBeLessThan(-4);
  });
});
