import * as THREE from 'three';

export function createAnimalSkins() {
  const pending = [];
  const skins = ['sauropod', 'triceratops'].map(species => {
    let resolve, reject;
    pending.push(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const map = new THREE.TextureLoader().load(`/textures/animals/${species}-color.webp`, resolve,
      undefined, () => reject(new Error(`${species} skin could not load`)));
    map.colorSpace = THREE.SRGBColorSpace;
    // Generated patches have unmatched borders; mirroring keeps repeated edges continuous.
    map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
    if (species === 'triceratops') map.repeat.set(2, 2);
    map.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ name: `${species} hide`, map,
      roughness: 0.86, metalness: 0 });
  });
  skins.ready = Promise.all(pending);
  return skins;
}
