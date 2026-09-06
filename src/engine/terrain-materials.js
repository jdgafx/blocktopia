import { TextureLoader } from './texture-loader.js';
import * as THREE from 'three';
import { ATLAS_URL } from '../ui/atlas.js';

// Existing BLOCK_DEFS tile order remains the material index contract.
export function buildTerrainMaterials(renderer) {
  const loader = new TextureLoader();
  const pending = [], cache = new Map(), loaded = new Map();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function texture(url, color = false) {
    if (cache.has(url)) return cache.get(url);
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending.push(ready); loaded.set(url, ready);
    const map = loader.load(url, resolve, undefined, () => reject(new Error(`Texture unavailable: ${url}`)));
    map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = anisotropy;
    cache.set(url, map);
    return map;
  }
  function pbr(name, options = {}, generated = false) {
    const base = `/textures/${generated ? 'generated' : 'pbr'}/${name}`;
    const extension = generated ? 'png' : 'jpg';
    return new THREE.MeshStandardMaterial({
      name, map: texture(`${base}-color.${extension}`, true),
      normalMap: texture(`${base}-normal.${extension}`),
      roughnessMap: texture(`${base}-roughness.${extension}`),
      normalScale: new THREE.Vector2(0.65, 0.65), roughness: 1, metalness: 0,
      envMapIntensity: 0.45, ...options,
    });
  }
  function illustrated(tile, name) {
    // ponytail: two semantic tiles retain authored color detail; replace with dedicated scans when available.
    const source = texture(ATLAS_URL, true);
    const map = new THREE.Texture();
    map.source = source.source;
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = anisotropy;
    // Share image data without Texture.copy scheduling an upload before it exists.
    pending.push(loaded.get(ATLAS_URL).then(() => { map.needsUpdate = true; }));
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const inset = 1 / 1254;
    map.repeat.set(0.25 - 2 * inset, 0.25 - 2 * inset);
    map.offset.set((tile % 4) * 0.25 + inset, 1 - (Math.floor(tile / 4) + 1) * 0.25 + inset);
    return new THREE.MeshStandardMaterial({ name, map, roughness: 0.9, envMapIntensity: 0.35 });
  }
  const materials = [
    pbr('sparse_grass'), illustrated(1, 'Grass edge'), pbr('brown_mud_rocks_01'),
    pbr('rock_boulder_dry'), pbr('log-end', { name: 'Log end' }, true), pbr('bark_brown_02'),
    illustrated(6, 'Leaves'), pbr('sand_01'), pbr('gravel_floor'),
    pbr('wood_floor_deck'), pbr('stone_brick_wall_001'),
    new THREE.MeshStandardMaterial({ name: 'Glass', color: 0xc4e7e7, transparent: true, opacity: 0.28,
      roughness: 0.08, metalness: 0, envMapIntensity: 0.8, depthWrite: false }),
    pbr('rock_boulder_dry', { name: 'Coal ore', color: 0x49464a }),
    pbr('rock_boulder_dry', { name: 'Iron ore', color: 0xba8064 }),
    pbr('rock_boulder_dry', { name: 'Bedrock', color: 0x717b82 }),
    new THREE.MeshStandardMaterial({ name: 'Water', color: 0x579aaa, roughness: 0.15, transparent: true, opacity: 0.7 }),
  ];
  materials.ready = Promise.all(pending);
  return materials;
}
