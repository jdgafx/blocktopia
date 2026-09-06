import { it, expect } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/engine/world.js';
import { Physics } from '../src/engine/physics.js';
import { raycast } from '../src/engine/raycast.js';
import { Buildings } from '../src/engine/buildings.js';
import { BLOCKS } from '../src/constants/blocks.js';

it('uses visible thin walls and roof surfaces for entry, collision and targeting', () => {
  const world = new World(29, 2), physics = new Physics(world);
  const position = { x: 18.3, y: 29, z: 2 };
  const clearFloor = new Physics({ isSolid: (_x, y) => y < 29 });
  const unobstructed = { ...position };
  for (let i = 0; i < 60; i++) {
    physics.update(position, { x: 0, z: -1 }, false, 1 / 60);
    clearFloor.update(unobstructed, { x: 0, z: -1 }, false, 1 / 60);
  }
  // Entry must travel as freely as open ground, including acceleration from rest.
  expect(position.z).toBeCloseTo(unobstructed.z, 5);
  expect(position.z).toBeLessThan(-2.5);
  expect(position.y).toBe(29);
  for (let i = 0; i < 60; i++) physics.update(position, { x: -1, z: 0 }, false, 1 / 60);
  expect(position.x).toBeCloseTo(15.66, 5);
  expect(world.getBlock(17, 33, -4)).toBe(BLOCKS.AIR);
  expect(world.getBuildingParts(17, 33, -4)).toEqual([]);
  expect(world.isSolid(17, 33, -4)).toBe(false);
  const roof = raycast(world, { x: 17.5, y: 33.2, z: -3.8 }, { x: 0, y: 1, z: 0 });
  expect(roof).toMatchObject({ x: 17, y: 34, z: -4, face: [0, -1, 0] });
  const rooftop = { x: 18.5, y: 38, z: -3.5 }, fall = new Physics(world);
  for (let i = 0; i < 120; i++) fall.update(rooftop, { x: 0, z: 0 }, false, 1 / 60);
  expect(rooftop.y).toBeCloseTo(35.5, 4);
  const roofControl = new Physics({ isSolid: (_x, y) => y < 0 });
  const openRoof = { ...rooftop, y: 0 }; roofControl.onGround = true;
  for (let i = 0; i < 24; i++) {
    fall.update(rooftop, { x: -1, z: 0 }, false, 1 / 60);
    roofControl.update(openRoof, { x: -1, z: 0 }, false, 1 / 60);
  }
  expect(rooftop.x).toBeCloseTo(openRoof.x, 4);
  expect(rooftop.x).toBeLessThan(17);
  for (let i = 0; i < 30; i++) {
    const previousX = rooftop.x;
    fall.update(rooftop, { x: 1, z: 0 }, false, 1 / 60);
    if (fall._vx >= 0) expect(rooftop.x).toBeGreaterThanOrEqual(previousX);
  }
  // The downslope briefly leaves the floor, so reversal uses air acceleration.
  // It must return up the roof without collision pushback and reach the ridge.
  expect(rooftop.x).toBeGreaterThan(18);
  expect(rooftop.x).toBeLessThan(19);
  expect(rooftop.y).toBeCloseTo(35.5, 4);
  expect(rooftop.y).toBeGreaterThan(35);

});

it('removes all cell-owned detail on mining and preserves same-ID replacements after regeneration', () => {
  const world = new World(29, 2);
  expect(world.getBuildingParts(15, 30, -3).length).toBeGreaterThan(0);
  world.setBlock(15, 30, -3, BLOCKS.AIR);
  expect(world.getBuildingParts(15, 30, -3)).toBeNull();
  world.setBlock(15, 30, -3, BLOCKS.PLANKS);
  world.retainAround(30, 30, 1);
  expect(world.getBlock(15, 30, -3)).toBe(BLOCKS.PLANKS);
  expect(world.getBuildingParts(15, 30, -3)).toBeNull();
  expect(world.getCollisionBoxes(15, 30, -3, { x: 15, y: 30, z: -3 }, { x: 16, y: 31, z: -2 })).toEqual([
    { min: { x: 15, y: 30, z: -3 }, max: { x: 16, y: 31, z: -2 } },
  ]);
});

it('bounds architecture draw calls, keeps geometry finite and attaches lantern light to its editable cell', () => {
  const world = new World(29, 2), terrain = Array.from({ length: 16 }, () => new THREE.MeshStandardMaterial());
  const buildings = new Buildings(terrain), chunk = world.getChunk(1, -1);
  for (const [index, parts] of chunk.buildingBlocks) {
    const x = chunk.cx * 16 + index % 16, y = Math.floor(index / 256), z = chunk.cz * 16 + Math.floor(index / 16) % 16;
    for (const p of parts) {
      expect(p.x0).toBeGreaterThanOrEqual(x - 1e-7); expect(p.x1).toBeLessThanOrEqual(x + 1 + 1e-7);
      expect(p.z0).toBeGreaterThanOrEqual(z - 1e-7); expect(p.z1).toBeLessThanOrEqual(z + 1 + 1e-7);
      expect(Math.min(p.b0, p.b1)).toBeGreaterThanOrEqual(y - 1e-7);
      expect(Math.max(p.t0, p.t1)).toBeLessThanOrEqual(y + 1 + 1e-7);
    }
  }
  const before = buildings.build(chunk);
  expect(before.children.filter(mesh => mesh.isMesh).length).toBeLessThanOrEqual(8);
  expect(before.children.filter(light => light.isPointLight)).toHaveLength(1);
  for (const mesh of before.children.filter(mesh => mesh.isMesh)) {
    expect([...mesh.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    expect([...mesh.geometry.attributes.normal.array].every(Number.isFinite)).toBe(true);
  }
  world.setBlock(16, 29, -6, BLOCKS.AIR);
  const after = buildings.build(chunk);
  expect(after.children.some(light => light.isPointLight)).toBe(false);
  buildings.remove(before); buildings.remove(after);
});
