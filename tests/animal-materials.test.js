import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createAnimalSkins } from '../src/game/animal-materials.js';

it('loads distinct animal skins with mirrored edges and physically based materials', async () => {
  const urls = [];
  const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, ready) => {
    urls.push(url); const texture = new THREE.Texture(); queueMicrotask(() => ready(texture)); return texture;
  });
  try {
    const skins = createAnimalSkins(); await skins.ready;
    expect(urls).toEqual(['/textures/animals/sauropod-color.webp', '/textures/animals/triceratops-color.webp']);
    expect(skins[0].map).not.toBe(skins[1].map);
    expect(skins.every(skin => skin.isMeshStandardMaterial && skin.map.colorSpace === THREE.SRGBColorSpace)).toBe(true);
    expect(skins.every(skin => skin.map.wrapS === THREE.MirroredRepeatWrapping && skin.map.wrapT === THREE.MirroredRepeatWrapping)).toBe(true);
  } finally { loader.mockRestore(); }
});
