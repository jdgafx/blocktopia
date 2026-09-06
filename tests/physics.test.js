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
