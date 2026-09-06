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
  expect(requests).toHaveLength(34);
  expect(materials.every(material => material.isMeshStandardMaterial)).toBe(true);
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14]) {
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
  for (const index of [0,1,2,3,4,5,6,7,8,9,10]) {
    expect(materials[index].aoMap).toBe(materials[index].roughnessMap);
    expect(materials[index].metalnessMap).toBe(materials[index].roughnessMap);
    expect(materials[index].vertexColors).toBe(true);
  }
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
