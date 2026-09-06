import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptWatabou } from '../scripts/maps/adapt-watabou.mjs';
import roads from '../scripts/maps/hearthwood-roads.js';
import { World } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';

describe('Watabou woodland lanes', () => {
  it('reproduces the source export and rejects malformed coordinates', () => {
    const source = JSON.parse(readFileSync(new URL('../public/maps/hearthwood-watabou.json', import.meta.url)));
    expect(adaptWatabou(source)).toEqual(roads);
    expect(roads[0].at(-1)).toEqual([39, -59]);
    expect(roads[1].at(-1)).toEqual([-55, -2]);
    source.features.find(f => f.id === 'roads').geometries[0].coordinates[0][0] = null;
    expect(() => adaptWatabou(source)).toThrow('Invalid Watabou coordinate');
  });

  it('makes both complete woodland approaches level, walkable, mineable and persistent', () => {
    const world = new World(29, 3), peer = new World(29, 3), cells = new Set();
    for (const road of roads) for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1], [bx, bz] = road[i];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
      for (let t = 0; t <= steps; t++) cells.add(`${Math.round(ax + (bx - ax) * t / steps)},${Math.round(az + (bz - az) * t / steps)}`);
    }
    for (const cell of [...cells].reverse()) {
      const [x, z] = cell.split(',').map(Number);
      peer.getBlock(x, 28, z);
    }
    for (const cell of cells) {
      const [x, z] = cell.split(',').map(Number);
      expect(world.surfaceHeight(x, z)).toBe(28);
      expect(world.isSolid(x, 28, z)).toBe(true);
      expect(world.isSolid(x, 29, z)).toBe(false);
      expect(world.isSolid(x, 30, z)).toBe(false);
      expect(world.getBlock(x, 28, z)).toBe(peer.getBlock(x, 28, z));
    }
    expect(world.getBlock(-55, 28, -2)).toBe(BLOCKS.GRAVEL);
    expect(new World(29, 2).getBlock(-55, 28, -2)).not.toBe(BLOCKS.GRAVEL);
    world.setBlock(-55, 28, -2, BLOCKS.AIR);
    world.retainAround(30, 30, 1);
    expect(world.getBlock(-55, 28, -2)).toBe(BLOCKS.AIR);
    expect(world.getBlock(8, 29, 8)).toBe(BLOCKS.AIR);
  });
});
