import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, clamp, float, floor, mix, normalMap, sin, texture as textureNode, uniform, uniformArray, uv, vec2 } from 'three/tsl';


// [material index, texture name, generated?, tint, metalness map]: the opaque tiles of the BLOCK_DEFS material index contract.
const TILES = [[0,'sparse_grass'],[1,'grass-edge',true],[2,'brown_mud_rocks_01'],[3,'rock_boulder_dry'],[4,'log-end',true],[5,'bark_brown_02'],
  [6,'leaf-tile',true],[7,'sand_01'],[8,'gravel_floor'],[9,'wood_floor_deck'],[10,'stone_brick_wall_001'],
  [12,'rock_boulder_dry',false,0x49464a],[13,'rock_boulder_dry',false,0xba8064,'/textures/generated/iron-orm.png'],[14,'rock_boulder_dry',false,0x717b82]];
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
  // Per-tile set for cottages, trunks, debris and the held item: no colour or wetness attribute, so none is read.
  const materials=fill(make());
  materials.time=uniform(0);

  // Terrain chunks draw once for every opaque tile: one shader picks the layer of three texture arrays by the per-vertex `tile`.
  const SIZE=1024, kinds={color:[],normal:[],orm:[]}, layer={color:[],normal:[],orm:[],metal:[]}, tints=Array.from({length:16},()=>new THREE.Color(1,1,1));
  const slot=(kind,url)=>{const at=kinds[kind].indexOf(url);return at<0?kinds[kind].push(url)-1:at;};
  for(const [index,name,generated,tint,metalUrl] of TILES){
    const base=`/textures/${generated?'generated':'pbr'}/${name}`,ext=generated?'png':'jpg';
    layer.color[index]=slot('color',`${base}-color.${ext}`);layer.normal[index]=slot('normal',`${base}-normal.${ext}`);
    layer.orm[index]=slot('orm',`${base}-orm.png`);layer.metal[index]=slot('orm',metalUrl??`${base}-orm.png`);
    if(tint)tints[index].set(tint);
  }
  const arrays=Object.fromEntries(Object.keys(kinds).map(kind=>[kind,Object.assign(new THREE.DataArrayTexture(null,1,1,1),{
    name:`terrain-${kind}`,wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,
    generateMipmaps:true,anisotropy,colorSpace:kind==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace})]));
  // shortcut: layers keep their JS pixel copy after upload (~130 MB), free it with texture.onUpdate when memory matters.
  function fillArrays(){
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.translate(0,SIZE);context.scale(1,-1);// flipY like TextureLoader maps
    for(const [kind,urls] of Object.entries(kinds)){
      const data=new Uint8Array(SIZE*SIZE*4*urls.length);
      urls.forEach((url,i)=>{context.clearRect(0,0,SIZE,SIZE);context.drawImage(cache.get(url).image,0,0,SIZE,SIZE);data.set(context.getImageData(0,0,SIZE,SIZE).data,i*SIZE*SIZE*4);});
      arrays[kind].image={data,width:SIZE,height:SIZE,depth:urls.length};arrays[kind].needsUpdate=true;
    }
  }
  const tile=floor(attribute('tile','float').add(0.5)).toInt(), pick=values=>uniformArray(Array.from({length:16},(_,i)=>values[i]??0),'float').element(tile).toInt();
  const sample=(kind,at)=>textureNode(arrays[kind],uv()).depth(pick(at));
  const orm=sample('orm',layer.orm), wet=clamp(attribute('wetness','float').mul(sin(materials.time.mul(1.7)).mul(0.2).add(0.8)),0,1);
  const opaque=new MeshStandardNodeMaterial({name:'Terrain',vertexColors:true,envMapIntensity:0.45});
  opaque.colorNode=sample('color',layer.color).mul(uniformArray(tints,'color').element(tile));
  opaque.normalNode=normalMap(sample('normal',layer.normal),vec2(0.65));
  opaque.aoNode=orm.r;
  opaque.roughnessNode=mix(orm.g,float(0.12),wet);
  opaque.metalnessNode=sample('orm',layer.metal).b;
  const glass=new MeshStandardNodeMaterial({name:'Glass',color:0xc4e7e7,transparent:true,opacity:0.28,roughness:0.08,metalness:0,envMapIntensity:0.8,depthWrite:false,vertexColors:true});
  // Draw buckets from geometryFromMesh: opaque, glass, water (the renderer swaps in its own water material).
  materials.chunk=[opaque,glass,null];
  materials.ready = Promise.all(pending).then(fillArrays);
  return materials;
}
