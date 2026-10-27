import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';
import { raycast } from '../src/engine/raycast.js';
import { Vegetation } from '../src/engine/vegetation.js';

it('fells only natural tree cells and preserves player replacements through regeneration', () => {
  const world = new World(29, 2);
  expect(world.isSolid(18, 36, 18)).toBe(false);
  expect(raycast(world, { x: 18.5, y: 36.5, z: 14 }, { x: 0, y: 0, z: 1 }, 10)).toBeNull();
  world.setBlock(19, 29, 19, BLOCKS.WOOD_LOG);
  const cells = world.getTreeBlocks(18, 29, 18);
  expect(cells).toHaveLength(311);
  expect(cells.some(cell => cell.x === 19 && cell.y === 29 && cell.z === 19)).toBe(false);
  for (const cell of cells) world.setBlock(cell.x, cell.y, cell.z, cell.blockId);
  world.retainAround(30, 30, 1);
  expect(world.getBlock(18, 36, 18)).toBe(BLOCKS.AIR);
  expect(world.getBlock(19, 29, 19)).toBe(BLOCKS.WOOD_LOG);
  expect(world.getNaturalTree(19, 29, 19)).toBeNull();
  expect(world.getTreeBlocks(19, 29, 19)).toEqual([]);
  world.setBlock(18, 36, 18, BLOCKS.LEAVES);
  expect(world.isSolid(18, 36, 18)).toBe(true);
  expect(raycast(world, { x: 18.5, y: 36.5, z: 17 }, { x: 0, y: 0, z: 1 })).toMatchObject({ x: 18, y: 36, z: 18 });
});

it('builds bounded merged foliage and removes tree visuals when committed timber cells are gone', () => {
  const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
  try {
    const world = new World(29, 2), chunk = world.getChunk(1, 1);
    chunk.trees = chunk.trees.filter(tree => tree.x === 18 && tree.z === 18);
    const vegetation = new Vegetation(new THREE.MeshStandardMaterial());
    const before = vegetation.build(chunk, world);
    const isLeaves = mesh => mesh.userData.leaves, bark = group => group.children.find(mesh => !isLeaves(mesh));
    expect(before.children.some(mesh => mesh.isInstancedMesh)).toBe(false);
    expect(bark(before)).toBeDefined();
    const foliage = before.children.find(isLeaves);
    const drawn = () => foliage.geometry.drawRange.count / foliage.geometry.userData.indicesPerLeaf;
    const fullCount = foliage.userData.fullCount;
    expect(fullCount).toBeGreaterThan(1000);
    expect(fullCount).toBeLessThan(10000);
    expect(foliage.material.alphaTest).toBe(.45);
    expect([...foliage.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    expect(foliage.geometry.attributes.color.count).toBe(foliage.geometry.attributes.position.count);
    const positions = foliage.geometry.attributes.position, geometry = bark(before).geometry;
    const cacheSize = vegetation.treeTemplates.size;
    vegetation.setLod(before, { x: 160, z: 160 });
    expect(drawn()).toBeLessThan(fullCount / 3);
    expect(foliage.castShadow).toBe(false);
    vegetation.setLod(before, { x: 18, z: 18 });
    expect(drawn()).toBe(fullCount);
    expect(foliage.geometry.attributes.position).toBe(positions);
    expect(bark(before).geometry).toBe(geometry);
    expect(vegetation.treeTemplates.size).toBe(cacheSize);
    for (const cell of world.getTreeBlocks(18, 29, 18)) world.setBlock(cell.x, cell.y, cell.z, cell.blockId);
    const after = vegetation.build(chunk, world);
    expect(after.children.some(mesh => !isLeaves(mesh))).toBe(false);
    expect(after.children.find(isLeaves)?.userData.fullCount ?? 0).toBeLessThan(fullCount);
    vegetation.remove(before); vegetation.remove(after);
  } finally { loader.mockRestore(); }
});
