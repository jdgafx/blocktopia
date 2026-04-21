import { describe, it, expect } from 'vitest';
import { Physics } from '../src/engine/physics.js';
import { BLOCKS } from '../src/constants/blocks.js';

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
});
