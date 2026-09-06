import { describe, it, expect, vi } from 'vitest';

import * as THREE from 'three';

import { buildChunkMesh } from '../src/engine/mesher.js';
import { buildAtlas } from '../src/ui/atlas.js';
import { Chunk, World } from '../src/engine/world.js';
import { BLOCKS } from '../src/constants/blocks.js';

describe('buildChunkMesh', () => {
  function meshSingleBlock(blockId) {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, blockId);
    const world = new World(1);
    world.getBlock = (x, y, z) => (x === 0 && y === 0 && z === 0 ? blockId : BLOCKS.AIR);
    return buildChunkMesh(chunk, world);
  }

  it('returns a BufferGeometry for an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const w = new World(1);
    const geo = buildChunkMesh(chunk, w);
    expect(geo).toBeDefined();
  });

  it('produces 4 vertices per exposed face', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.STONE);
    const w = new World(1);
    w.getBlock = (x, y, z) => (x === 0 && y === 0 && z === 0 ? BLOCKS.STONE : BLOCKS.AIR);
    const geo = buildChunkMesh(chunk, w);
    // 6 faces × 4 verts = 24 verts
    expect(geo._posCount).toBe(6 * 4);
  });

  it('hides face between two adjacent solid blocks', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.STONE);
    chunk.setBlock(1, 0, 0, BLOCKS.STONE);
    const w = new World(1);
    w.getBlock = (x, y, z) => {
      if ((x === 0 || x === 1) && y === 0 && z === 0) return BLOCKS.STONE;
      return BLOCKS.AIR;
    };
    const geo = buildChunkMesh(chunk, w);
    // 2 blocks × 6 faces = 12 total, minus 2 shared internal faces = 10 exposed → 40 verts
    expect(geo._posCount).toBe(10 * 4);
  });

  it('configures the production atlas for filtered top-origin sampling without atlas mip bleeding', () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(url => Object.assign(new THREE.Texture(), { url }));
    const texture = buildAtlas();
    expect(load).toHaveBeenCalledWith('/textures/natural-atlas.png', expect.any(Function), undefined, expect.any(Function));
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe('srgb');
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    load.mockRestore();
  });

  it('uses independent full-tile UVs and one non-overlapping draw group per material', () => {
    const grass = meshSingleBlock(BLOCKS.GRASS);
    expect([...grass.attributes.uv.array].every(value => value === 0 || value === 1)).toBe(true);
    expect(grass.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 24, materialIndex: 1 },
      { start: 30, count: 6, materialIndex: 2 },
    ]);
    expect(grass.index.count).toBe(36);
    expect(meshSingleBlock(BLOCKS.WOOD_LOG).groups.map(group => group.materialIndex)).toEqual([4, 5]);
    expect(meshSingleBlock(BLOCKS.COAL_ORE).groups[0].materialIndex).toBe(12);
  });

  it('culls shared glass faces while keeping exterior glass faces', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BLOCKS.GLASS); chunk.setBlock(1, 0, 0, BLOCKS.GLASS);
    const world = { getBlock: (x, y, z) => y === 0 && z === 0 && (x === 0 || x === 1) ? BLOCKS.GLASS : BLOCKS.AIR };
    const geo = buildChunkMesh(chunk, world);
    expect(geo._posCount).toBe(40);
    expect(geo.groups).toEqual([{ start: 0, count: 60, materialIndex: 11 }]);
  });

  it('winds top and bottom triangles toward their declared normals', () => {
    const positions = meshSingleBlock(BLOCKS.STONE).attributes.position.array;
    const triangleNormalY = (vertexOffset) => {
      const i = vertexOffset * 3;
      const abx = positions[i + 3] - positions[i];
      const abz = positions[i + 5] - positions[i + 2];
      const acx = positions[i + 6] - positions[i];
      const acz = positions[i + 8] - positions[i + 2];
      return abz * acx - abx * acz;
    };

    expect(triangleNormalY(0)).toBeGreaterThan(0);
    expect(triangleNormalY(4)).toBeLessThan(0);
  });
});
