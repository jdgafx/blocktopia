import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildTerrainMaterials } from '../src/engine/terrain-materials.js';

afterEach(() => vi.restoreAllMocks());

it('loads verified local scans with correct PBR color spaces, mip filters and shared GPU maps', async () => {
  const requests = [];
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, loaded) => {
    const map = new THREE.Texture();
    requests.push({ url, map });
    queueMicrotask(() => { map.image = { width: 1024, height: 1024 }; loaded(map); });
    return map;
  });
  const materials = buildTerrainMaterials({ capabilities: { getMaxAnisotropy: () => 16 } });
  for (const index of [1, 6]) expect(materials[index].map.version).toBe(0);
  await materials.ready;
  expect(materials).toHaveLength(16);
  expect(requests).toHaveLength(28);
  expect(materials.every(material => material.isMeshStandardMaterial)).toBe(true);
  for (const index of [0, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14]) {
    const material = materials[index];
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(material.map.generateMipmaps).toBe(true);
    expect(material.map.anisotropy).toBe(8);
    expect(material.map.wrapS).toBe(THREE.RepeatWrapping);
  }
  expect(materials[3].normalMap).toBe(materials[12].normalMap);
  expect(materials[11].transparent).toBe(true);
  expect(materials[11].depthWrite).toBe(false);
  for (const index of [1, 6]) {
    const map = materials[index].map;
    expect(map.image).toBeDefined();
    expect(map.version).toBe(1);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(map.anisotropy).toBe(8);
    expect(map.generateMipmaps).toBe(false);
    expect(map.flipY).toBe(true);
  }
  expect(materials[1].map.offset.y).toBeCloseTo(0.75 + 1 / 1254);
  expect(materials[6].map.offset.y).toBeCloseTo(0.5 + 1 / 1254);
  const provenance = JSON.parse(readFileSync(new URL('../public/textures/pbr/provenance.json', import.meta.url)));
  expect(provenance.sources).toHaveLength(24);
  for (const source of provenance.sources) {
    const bytes = readFileSync(new URL(`../public/textures/pbr/${source.file}`, import.meta.url));
    expect(createHash('md5').update(bytes).digest('hex')).toBe(source.md5);
  }
});

it('reports failed material requests instead of claiming textures loaded', async () => {
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, loaded, progress, failed) => {
    queueMicrotask(failed);
    return new THREE.Texture();
  });
  const materials = buildTerrainMaterials({ capabilities: { getMaxAnisotropy: () => 1 } });
  await expect(materials.ready).rejects.toThrow('Texture unavailable: /textures/pbr/sparse_grass-color.jpg');
});
