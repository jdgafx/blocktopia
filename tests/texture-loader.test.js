import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TextureLoader } from '../src/engine/texture-loader.js';

it('limits concurrent transfers and releases slots after success or failure', async () => {
  const requests = [];
  const mock = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, done, progress, fail) => {
    requests.push({ url, done, fail });
    return new THREE.Texture();
  });
  try {
    const loader = new TextureLoader();
    const textures = Array.from({ length: 7 }, (_, i) => loader.load(`${i}.png`, undefined, undefined, () => {}));
    const source = textures[4].source;
    textures[4].colorSpace = THREE.SRGBColorSpace;
    expect(requests).toHaveLength(4);
    requests[0].fail(new Error('Network interrupted'));
    expect(requests).toHaveLength(5);
    requests[1].done(new THREE.Texture());
    expect(requests).toHaveLength(6);
    requests[2].done(new THREE.Texture());
    expect(requests).toHaveLength(7);
    requests[3].done(new THREE.Texture());
    const image = { width: 512, height: 512 };
    requests[4].done(new THREE.Texture(image));
    requests[5].done(new THREE.Texture());
    requests[6].done(new THREE.Texture());
    expect(textures[4].source).toBe(source);
    expect(source.data).toBe(image);
    expect(textures[4].colorSpace).toBe(THREE.SRGBColorSpace);
    const ready = loader.loadAsync('last.png');
    requests[7].done(new THREE.Texture(image));
    expect((await ready).image).toBe(image);
  } finally { mock.mockRestore(); }
});
