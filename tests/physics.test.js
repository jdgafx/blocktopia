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

  it('stands stable straddling a block boundary (multi-block floor)', () => {
    // Regression: player at x=8.0 overlaps floor columns 7 and 8. The old
    // resolver zeroed vy on the first floor block, flipping later blocks in
    // the same row to the ceiling branch -> sank 1 block per frame.
    const world = solidWorld((x, y, z) => y < 30);
    const phys = new Physics(world);
    const pos = { x: 8.0, y: 30, z: 8.0 };
    for (let i = 0; i < 60; i++) {
      phys.update(pos, { x: 0, z: 0 }, false, 1 / 60);
    }
    expect(pos.y).toBeCloseTo(30, 3);
    expect(phys.onGround).toBe(true);
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
