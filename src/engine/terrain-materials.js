import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, clamp, float, materialRoughness, mix, sin, uniform } from 'three/tsl';


// Existing BLOCK_DEFS tile order remains the material index contract.
export function buildTerrainMaterials(renderer) {
  const loader = new THREE.TextureLoader();
  const pending = [], cache = new Map(), loaded = new Map();
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
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
    return new MeshStandardNodeMaterial({
      name, map: texture(`${base}-color.${extension}`, true),
      normalMap: texture(`${base}-normal.${extension}`),
      roughnessMap: texture(`${base}-orm.png`), aoMap: texture(`${base}-orm.png`), metalnessMap: texture(`${base}-orm.png`),
      normalScale: new THREE.Vector2(0.65, 0.65), roughness: 1, metalness: 1,
      envMapIntensity: 0.45, ...options,
    });
  }
  const make = () => [
    pbr('sparse_grass'), pbr('grass-edge', { name: 'Grass edge' }, true), pbr('brown_mud_rocks_01'),
    pbr('rock_boulder_dry'), pbr('log-end', { name: 'Log end' }, true), pbr('bark_brown_02'),
    pbr('leaf-tile', { name: 'Leaves' }, true), pbr('sand_01'), pbr('gravel_floor'),
    pbr('wood_floor_deck'), pbr('stone_brick_wall_001'),
    new MeshStandardNodeMaterial({ name: 'Glass', color: 0xc4e7e7, transparent: true, opacity: 0.28,
      roughness: 0.08, metalness: 0, envMapIntensity: 0.8, depthWrite: false }),
    pbr('rock_boulder_dry', { name: 'Coal ore', color: 0x49464a }),
    pbr('rock_boulder_dry', { name: 'Iron ore', color: 0xba8064, metalnessMap: texture('/textures/generated/iron-orm.png') }),
    pbr('rock_boulder_dry', { name: 'Bedrock', color: 0x717b82 }),
    new MeshStandardNodeMaterial({ name: 'Water', color: 0x579aaa, roughness: 0.15, transparent: true, opacity: 0.7 }),
  ];
  const flatNormal=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);flatNormal.needsUpdate=true;
  const flatORM=new THREE.DataTexture(new Uint8Array([255,255,0,255]),1,1);flatORM.needsUpdate=true;
  const fill=list=>{list.forEach(material=>{material.normalMap??=flatNormal;material.aoMap??=flatORM;material.metalnessMap??=flatORM;});return list;};
  const materials=fill(make());
  // Cottages, trunks and debris have no colour or wetness attribute: this set reads neither.
  materials.plain=fill(make());
  materials.time=uniform(0);
  materials.forEach(material=>{
    material.vertexColors=true;
    const wet=clamp(attribute('wetness','float').mul(sin(materials.time.mul(1.7)).mul(0.2).add(0.8)),0,1);
    material.roughnessNode=mix(materialRoughness,float(0.12),wet);
  });
  materials.ready = Promise.all(pending);
  return materials;
}
