import * as THREE from 'three';

// Avoid saturating one CDN connection with all terrain and creature images at once.
const pending = [];
let active = 0;
function startNext() {
  while (active < 4 && pending.length) {
    active++;
    pending.shift()();
  }
}

export class TextureLoader extends THREE.TextureLoader {
  load(url, onLoad, onProgress, onError) {
    const texture = new THREE.Texture();
    pending.push(() => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        try { callback?.(value); }
        finally { active--; startNext(); }
      };
      try {
        super.load(url, loaded => {
          // Keep the Source object: atlas tiles share it before the image arrives.
          texture.image = loaded.image;
          texture.needsUpdate = true;
          finish(onLoad, texture);
        }, onProgress, error => finish(onError, error));
      } catch (error) { finish(onError, error); }
    });
    startNext();
    return texture;
  }
}
