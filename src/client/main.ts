/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import PartySocket from 'partysocket';
import { DinoState, HarvestChunk, PartName } from '../shared/types';

// ====================================================================================================
// 1. SCENE, CAMERA, DYNAMIC GRAPHICS SCALER & LIGHTING SETUP
// ====================================================================================================
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8d4);
scene.fog = new THREE.FogExp2(0x87b8d4, 0.0065);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 700);

// Soft image-based light so painted metal and scales pick up reflections
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

// Gradient sky dome that follows the camera; its horizon colour matches the fog
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    top: { value: new THREE.Color(0x4f95d0) },
    horizon: { value: new THREE.Color(0x87b8d4) },
    sunDir: { value: new THREE.Vector3(60, 95, 40).normalize() },
    night: { value: 0 }
  },
  vertexShader: 'varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float night; varying vec3 dir;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
    void main() {
      vec3 d = normalize(dir);
      vec3 c = mix(horizon, top, pow(clamp(d.y * 1.6, 0.0, 1.0), 0.6));
      float s = max(dot(d, sunDir), 0.0);
      // Day: a hot sun disc with a soft halo. Eclipse: a black disc ringed by a blood-red corona, plus stars.
      c += vec3(1.0, 0.9, 0.7) * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.22) * (1.0 - night);
      c += vec3(1.0, 0.12, 0.2) * (pow(s, 260.0) * 3.5 + pow(s, 20.0) * 0.25) * night;
      c *= 1.0 - night * smoothstep(0.99935, 0.9996, s);
      c += vec3(0.8, 0.85, 1.0) * step(0.9988, hash(floor(d * 240.0))) * night * smoothstep(0.02, 0.2, d.y);
      gl_FragColor = vec4(c, 1.0);
    }`
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), skyMat);
skyDome.renderOrder = -1;
skyDome.frustumCulled = false;
scene.add(skyDome);

// Sun & Ambient Lighting (Morphs dynamically into Pitch-Black Eclipse Nightfall in Phase 2)
const hemiLight = new THREE.HemisphereLight(0xdff6ff, 0x2b3a26, 0.85);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff1d0, 2.4);
sunLight.position.set(60, 95, 40);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 260;
const d = 95;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

// Player Helmet Flashlight (For Phase 2 Nightfall Stalker Horror)
const flashlight = new THREE.SpotLight(0xe0fbfc, 0, 85, Math.PI / 5, 0.45, 1.5);
scene.add(flashlight);
scene.add(flashlight.target);

// Bloom so plasma edges, bio-stripes, lanterns and the eclipse corona actually glow
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 })
);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.7, 1.15);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Blender-built models (see tools/build_models.py). Anything that fails to load falls back to
// the original box-primitive placeholder so the game still runs without the .glb files.
const gltfLoader = new GLTFLoader();
async function loadModel(name: string): Promise<THREE.Group | null> {
  try {
    const gltf = await gltfLoader.loadAsync(`/models/${name}.glb`);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return gltf.scene;
  } catch (err) {
    console.warn(`Model ${name}.glb unavailable, using placeholder geometry`, err);
    return null;
  }
}
const [rexModel, stegoModel, raptorModel, truckModel, brontoModel, envModel, sanctuaryModel, propsModel] = await Promise.all(
  ['voltaic_rex', 'stego_titan', 'shadow_raptor', 'truck', 'bronto', 'environment', 'sanctuary', 'props'].map(loadModel)
);
const dinoModels: Record<string, THREE.Group | null> = {
  voltaic_rex: rexModel,
  stego_titan: stegoModel,
  shadow_raptor: raptorModel
};

// ====================================================================================================
// 2. PREHISTORIC JUNGLE ENVIRONMENT + SANCTUARY BASE + 110FT CANOPY BRONTOSAURUS MOBILE BASE
// ====================================================================================================
const groundGeo = new THREE.PlaneGeometry(500, 500, 64, 64);
groundGeo.rotateX(-Math.PI / 2);
// Subtle terrain undulations
function groundHeight(x: number, z: number) {
  return Math.abs(x) > 18 && z < 25 ? Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.6 : 0;
}
const posAttr = groundGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  posAttr.setY(i, groundHeight(posAttr.getX(i), posAttr.getZ(i)));
}
groundGeo.computeVertexNormals();

// Speckled grass/dirt texture painted onto a canvas and tiled across the ground
function makeSpeckleTexture(base: string, hue: [number, number], sat: [number, number], light: [number, number], repeat: number) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const pick = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
  const tone = (a: number) => `hsla(${pick(hue)}, ${pick(sat)}%, ${pick(light)}%, ${a})`;
  // Broad soft patches first, then fine blades/grit. Everything is drawn nine times so the tile wraps cleanly.
  const stamp = (draw: (x: number, y: number) => void) => {
    const x = Math.random() * size;
    const y = Math.random() * size;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 260; i++) {
    const r = 30 + Math.random() * 90;
    ctx.fillStyle = tone(0.12);
    stamp((x, y) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
  }
  for (let i = 0; i < 26000; i++) {
    const w = 1 + Math.random() * 2;
    const h = 2 + Math.random() * 7;
    ctx.fillStyle = tone(0.55);
    stamp((x, y) => ctx.fillRect(x, y, w, h));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const groundMat = new THREE.MeshStandardMaterial({
  map: makeSpeckleTexture('#2f4a2a', [85, 125], [30, 55], [14, 27], 28),
  roughness: 0.95,
  metalness: 0
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Packed-dirt road from the Sanctuary gate out into the hunting grounds
const roadTex = makeSpeckleTexture('#5a4630', [22, 40], [20, 40], [16, 34], 1);
roadTex.repeat.set(2, 14);
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(13, 110).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: roadTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 })
);
road.position.set(0, 0.02, 25);
road.receiveShadow = true;
scene.add(road);

// Sanctuary Safe-Zone Gate & Cozy Spit-Roast Campfire (Z = +55)
const sanctuaryGroup = new THREE.Group();
sanctuaryGroup.position.set(0, 0, 58);
scene.add(sanctuaryGroup);

const gatePillarGeo = new THREE.BoxGeometry(4, 18, 4);
const gateMat = new THREE.MeshStandardMaterial({ color: 0x3b4958, roughness: 0.5, metalness: 0.6 });
const leftPillar = new THREE.Mesh(gatePillarGeo, gateMat);
leftPillar.position.set(-14, 9, 0);
leftPillar.castShadow = true;
const rightPillar = new THREE.Mesh(gatePillarGeo, gateMat);
rightPillar.position.set(14, 9, 0);
rightPillar.castShadow = true;
const gateArch = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 5), gateMat);
gateArch.position.set(0, 18, 0);
if (sanctuaryModel) sanctuaryGroup.add(sanctuaryModel);
else sanctuaryGroup.add(leftPillar, rightPillar, gateArch);

// Cozy Spit-Roast Grill & Campfire inside Sanctuary
const fireLight = new THREE.PointLight(0xff7b00, 6, 30);
fireLight.position.set(-8, 2.5, 10);
sanctuaryGroup.add(fireLight);

const spitRoastMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 1.1, 3.6, 12),
  new THREE.MeshStandardMaterial({ color: 0x9e2a2b, roughness: 0.4, emissive: 0x3a0ca3, emissiveIntensity: 0.2 })
);
spitRoastMesh.rotation.z = Math.PI / 2;
spitRoastMesh.position.set(-8, 2.2, 10);
if (!sanctuaryModel) sanctuaryGroup.add(spitRoastMesh);
const spitSpinner: THREE.Object3D = sanctuaryModel?.getObjectByName('Spit_Roast') || spitRoastMesh;

// 110ft Friendly Canopy Brontosaurus with a Cozy Mobile Treehouse Base on its Back (Pitch C)
const brontoGroup = new THREE.Group();
brontoGroup.position.set(40, 0, 84);
scene.add(brontoGroup);
if (brontoModel) {
  brontoModel.rotation.y = -0.5;
  brontoGroup.add(brontoModel);
}
const brontoMat = new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.7 });
const brontoBody = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 18), brontoMat);
brontoBody.position.y = 10;
const brontoNeck = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.8, 22, 10), brontoMat);
brontoNeck.position.set(0, 20, -9);
brontoNeck.rotation.x = 0.35;
const brontoCabin = new THREE.Mesh(
  new THREE.BoxGeometry(8, 5, 12),
  new THREE.MeshStandardMaterial({ color: 0x8d5b4c, roughness: 0.8 })
);
brontoCabin.position.set(0, 16.5, 0);
if (!brontoModel) brontoGroup.add(brontoBody, brontoNeck, brontoCabin);

// Instanced Prehistoric Jungle Trees & Glowing Bio-Ferns
const trunkGeo = new THREE.CylinderGeometry(0.6, 1.1, 14, 7);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
const canopyGeo = new THREE.DodecahedronGeometry(5.5, 1);
const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e4620, roughness: 0.75 });

// One InstancedMesh per material of a prop, stamped at every transform
const windTime = { value: 0 };
const swayMaterials = new Map<THREE.Material, THREE.Material>();

// Copy of a material whose vertices lean with the wind, more the higher they are above the root
function swayMaterial(src: THREE.Material) {
  let m = swayMaterials.get(src);
  if (!m) {
    m = src.clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = windTime;
      shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 rootPos = instanceMatrix[3].xyz;
          float gust = sin(uWind * 1.6 + rootPos.x * 0.31 + rootPos.z * 0.27) + 0.5 * sin(uWind * 3.7 + rootPos.x * 1.3);
          float bend = gust * 0.07 * max(position.y, 0.0);
          transformed.x += bend;
          transformed.z += bend * 0.6;
        #endif`
      );
    };
    swayMaterials.set(src, m);
  }
  return m;
}

function scatterInstanced(
  template: THREE.Object3D,
  transforms: THREE.Matrix4[],
  castShadow: boolean,
  opts: { sway?: boolean; parent?: THREE.Object3D } = {}
) {
  const made: THREE.InstancedMesh[] = [];
  if (transforms.length === 0) return made;
  template.updateWorldMatrix(true, true);
  const inverse = template.matrixWorld.clone().invert();
  template.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const rel = inverse.clone().multiply(m.matrixWorld);
    const material = opts.sway ? swayMaterial(m.material as THREE.Material) : m.material;
    const inst = new THREE.InstancedMesh(m.geometry, material, transforms.length);
    transforms.forEach((t, i) => inst.setMatrixAt(i, t.clone().multiply(rel)));
    inst.castShadow = castShadow;
    inst.receiveShadow = true;
    (opts.parent || scene).add(inst);
    made.push(inst);
  });
  return made;
}

const groundCover: THREE.InstancedMesh[] = [];

// Scatters `count` props inside a `spread`-wide square. Big props (clear > 0) stay out of the
// Sanctuary and keep `clear` units away from the Titans' clearing; ground cover only avoids the road.
function scatterProps(names: string[], count: number, scale: [number, number], spread: number, clear: number) {
  if (!envModel) return;
  const buckets = names.map(() => [] as THREE.Matrix4[]);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * spread;
    const z = (Math.random() - 0.5) * spread - 30;
    if (Math.abs(x) < 9 && z > -32) continue;                                  // the road
    if (clear > 0 && Math.abs(x) < 66 && z > 50 && z < 125) continue;                       // inside the Sanctuary walls
    if (clear > 0 && Math.abs(x) < 22 && z > 20) continue;                     // gate approach
    if (clear > 0 && Math.hypot(x, z + 50) < clear) continue;                  // Titan clearing
    const s = scale[0] + Math.random() * (scale[1] - scale[0]);
    buckets[Math.floor(Math.random() * names.length)].push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, groundHeight(x, z) - 0.05, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2),
        new THREE.Vector3(s, s * (0.85 + Math.random() * 0.3), s)
      )
    );
  }
  names.forEach((name, i) => {
    const template = envModel.getObjectByName(name);
    if (!template) return;
    const made = scatterInstanced(template, buckets[i], clear > 0, { sway: clear === 0 });
    if (clear === 0) groundCover.push(...made);
  });
}

scatterProps(['Tree_A', 'Tree_A', 'Tree_B', 'Tree_C'], 190, [0.75, 1.5], 340, 26);
scatterProps(['Rock'], 70, [0.6, 2.4], 320, 8);
scatterProps(['Log'], 36, [0.8, 1.5], 300, 8);
scatterProps(['Bush'], 170, [0.7, 1.6], 320, 14);
scatterProps(['Ribcage'], 7, [0.8, 1.3], 260, 34);
scatterProps(['Fern', 'Fern', 'Fern', 'Fern_Glow'], 520, [0.7, 1.9], 320, 0);
scatterProps(['Mushrooms'], 150, [0.8, 2.2], 300, 0);
scatterProps(['Grass'], 9000, [0.8, 1.8], 250, 0);

// Ring of fog-shrouded mountains on the horizon
const mountain = envModel?.getObjectByName('Mountain');
if (mountain) {
  const ring: THREE.Matrix4[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
    const s = 0.8 + Math.random() * 0.9;
    ring.push(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * 265, 0, Math.sin(a) * 265 - 20),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2),
      new THREE.Vector3(s, s * (0.5 + Math.random() * 0.5), s)
    ));
  }
  scatterInstanced(mountain, ring, false);
}

// Slow-drifting clouds above the fog
const cloudLayer = new THREE.Group();
scene.add(cloudLayer);
const cloudTemplate = envModel?.getObjectByName('Cloud');
if (cloudTemplate) {
  const spots: THREE.Matrix4[] = [];
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 380;
    const s = 1.2 + Math.random() * 2.2;
    spots.push(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r, 120 + Math.random() * 70, Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI),
      new THREE.Vector3(s, s * 0.8, s)
    ));
  }
  for (const inst of scatterInstanced(cloudTemplate, spots, false, { parent: cloudLayer })) {
    const cloudMat = (inst.material as THREE.MeshStandardMaterial).clone();
    cloudMat.fog = false;
    inst.material = cloudMat;
    inst.receiveShadow = false;
  }
}

// Drifting pollen by day, fireflies during the eclipse; the cloud of motes follows the player
const MOTES = 500;
const moteSeeds = new Float32Array(MOTES * 3).map(() => Math.random());
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
const moteMat = new THREE.PointsMaterial({
  color: 0xfff2b0, size: 0.22, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending
});
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false;
scene.add(motes);

// Embers rising from the Sanctuary campfire
const EMBERS = 60;
const emberGeo = new THREE.BufferGeometry();
emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
  color: 0xff8a2a, size: 0.28, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
}));
embers.position.set(-8, 0, 68);
embers.frustumCulled = false;
scene.add(embers);

for (let i = 0; i < (envModel ? 0 : 65); i++) {
  const tx = (Math.random() - 0.5) * 260;
  const tz = (Math.random() - 0.5) * 240 - 30;
  if (Math.abs(tx) < 22 && tz > 15) continue; // Keep Sanctuary road clear
  const tree = new THREE.Group();
  tree.position.set(tx, 0, tz);
  const scale = 0.8 + Math.random() * 0.9;
  tree.scale.setScalar(scale);

  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 7;
  trunk.castShadow = true;
  const leaves = new THREE.Mesh(canopyGeo, canopyMat);
  leaves.position.y = 14;
  leaves.castShadow = true;
  tree.add(trunk, leaves);
  scene.add(tree);
}

// ====================================================================================================
// 3. ALL-TERRAIN HARVESTER TRUCK & REAR TOW-WINCH CABLE
// ====================================================================================================
const truckGroup = new THREE.Group();
truckGroup.position.set(0, 0, 35);
scene.add(truckGroup);

const truckChassis = new THREE.Mesh(
  new THREE.BoxGeometry(5.2, 2.2, 9.5),
  new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.5 })
);
truckChassis.position.y = 1.8;
truckChassis.castShadow = true;

const truckCab = new THREE.Mesh(
  new THREE.BoxGeometry(4.8, 2.2, 3.8),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.7 })
);
truckCab.position.set(0, 3.6, -1.8);
if (truckModel) truckGroup.add(truckModel);
else truckGroup.add(truckChassis, truckCab);

// High-beams that switch on with the truck's headlights during the eclipse
const truckBeams = [-1.7, 1.7].map((x) => {
  const beam = new THREE.SpotLight(0xfff3c4, 0, 130, 0.55, 0.5, 1.2);
  beam.position.set(x, 2.9, -5.9);
  beam.target.position.set(x, 0.5, -45);
  truckGroup.add(beam, beam.target);
  return beam;
});

// Visual Tow-Winch Cable Line (Connects Truck to Heavy Bio-Heart / Skull)
const winchLineMat = new THREE.LineBasicMaterial({ color: 0x00f5d4, linewidth: 3 });
const winchLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const winchLine = new THREE.Line(winchLineGeo, winchLineMat);
winchLine.visible = false;
scene.add(winchLine);

// ====================================================================================================
// 4. ARTICULATED 3D DINOSAUR RIG + MULTI-HITBOX CHOPPING + BIO-AMBER STUMPS + TUMBLING LIMBS
// ====================================================================================================
interface ClientDinoRig {
  id: string;
  species: 'voltaic_rex' | 'stego_titan' | 'shadow_raptor';
  root: THREE.Group;
  partMeshes: Map<PartName, THREE.Object3D>;
  stumpMeshes: Map<PartName, THREE.Mesh>;
  hitMeshes: THREE.Mesh[];
  legL: THREE.Group;
  legR: THREE.Group;
  frontLegL?: THREE.Group;
  frontLegR?: THREE.Group;
  gait?: number;  // 0 standing still .. 1 full stride
  phase?: number; // walk-cycle angle, advanced only while moving
  tailGroup: THREE.Group;
  headGroup: THREE.Group;
  state: DinoState;
}

const clientDinos = new Map<string, ClientDinoRig>();
const tumblingDebris: Array<{ mesh: THREE.Object3D; vel: THREE.Vector3; rotVel: THREE.Vector3; age: number }> = [];
const particleBursts: Array<{ points: THREE.Points; vel: Float32Array; age: number }> = [];

// Bio-Amber Glowing Wound Material (Sponsor-Safe, High-Contrast Next-Gen Gore)
const bioAmberStumpMat = new THREE.MeshStandardMaterial({
  color: 0xff9f1c,
  emissive: 0xff5400,
  emissiveIntensity: 3.2,
  roughness: 0.2
});

function isShown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function dinoScale(species: DinoState['species']) {
  return species === 'shadow_raptor' ? 0.32 : species === 'voltaic_rex' ? 1.15 : 1.25;
}

const stumpGeo = new THREE.SphereGeometry(1, 14, 10);

// Builds a rig from a Blender model: named part objects are re-parented under hinge groups placed
// at the model's `Pivot_*` markers, and a glowing wound is parked at each `Stump_*` marker.
function buildModelDinoRig(state: DinoState, template: THREE.Object3D): ClientDinoRig {
  const root = new THREE.Group();
  scene.add(root);
  const model = template.clone(true);
  root.add(model);
  root.updateMatrixWorld(true);

  const hinge = (marker: string) => {
    const g = new THREE.Group();
    model.getObjectByName(marker)?.getWorldPosition(g.position);
    root.add(g);
    return g;
  };
  const headGroup = hinge('Pivot_Head');
  const tailGroup = hinge('Pivot_Tail');
  const legL = hinge('Pivot_LegL');
  const legR = hinge('Pivot_LegR');
  let frontLegL: THREE.Group | undefined;
  let frontLegR: THREE.Group | undefined;
  const frontL = model.getObjectByName('FLeg_L');
  const frontR = model.getObjectByName('FLeg_R');
  root.updateMatrixWorld(true);
  if (frontL && frontR) {
    frontLegL = hinge('Pivot_FLegL');
    frontLegR = hinge('Pivot_FLegR');
    root.updateMatrixWorld(true);
    frontLegL.attach(frontL);
    frontLegR.attach(frontR);
  }

  const partMeshes = new Map<PartName, THREE.Object3D>();
  const stumpMeshes = new Map<PartName, THREE.Mesh>();
  const hitMeshes: THREE.Mesh[] = [];

  const register = (partName: PartName, parent: THREE.Object3D) => {
    const part = model.getObjectByName(partName);
    if (!part) return undefined;
    const tag = { dinoId: state.id, partName };
    part.traverse((o) => {
      o.userData = tag;
      if ((o as THREE.Mesh).isMesh) hitMeshes.push(o as THREE.Mesh);
    });

    const stump = new THREE.Mesh(stumpGeo, bioAmberStumpMat);
    const marker = model.getObjectByName(`Stump_${partName}`);
    if (marker) {
      marker.getWorldPosition(stump.position);
      stump.scale.setScalar(marker.getWorldScale(new THREE.Vector3()).x);
    } else {
      part.getWorldPosition(stump.position);
    }
    root.add(stump);
    parent.attach(part);
    parent.attach(stump);

    const severed = state.parts?.[partName]?.severed || false;
    part.visible = !severed;
    stump.visible = severed;
    partMeshes.set(partName, part);
    stumpMeshes.set(partName, stump);
    return part;
  };

  register('Bio_Core', root);
  register('Back_Plates', root);
  register('Head_Armor', headGroup);
  const tailUpper = register('Tail_Upper', tailGroup);
  register('Tail_Tip', tailUpper || tailGroup); // the tip rides on (and is lost with) the tail base
  register('Leg_L_Tendon', legL);
  register('Leg_R_Tendon', legR);

  root.position.set(state.x, 0, state.z);
  root.scale.setScalar(dinoScale(state.species));
  return {
    id: state.id, species: state.species, root, partMeshes, stumpMeshes, hitMeshes,
    legL, legR, frontLegL, frontLegR, tailGroup, headGroup, state
  };
}

function buildArticulatedDinoRig(state: DinoState): ClientDinoRig {
  const template = dinoModels[state.species];
  if (template) return buildModelDinoRig(state, template);

  const root = new THREE.Group();
  root.position.set(state.x, 0, state.z);
  scene.add(root);

  const isRex = state.species === 'voltaic_rex';
  const isRaptor = state.species === 'shadow_raptor';
  const scale = isRaptor ? 0.32 : isRex ? 1.15 : 1.25;
  root.scale.setScalar(scale);

  const skinColor = isRaptor ? 0x1a1423 : isRex ? 0x2b3a42 : 0x384d3b;
  const plateColor = isRaptor ? 0xff0055 : isRex ? 0x00f5d4 : 0xff9f1c;

  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.55, metalness: 0.15 });
  const armorMat = new THREE.MeshStandardMaterial({
    color: plateColor,
    emissive: plateColor,
    emissiveIntensity: isRaptor ? 1.8 : 0.45,
    roughness: 0.3,
    metalness: 0.5
  });

  const partMeshes = new Map<PartName, THREE.Object3D>();
  const stumpMeshes = new Map<PartName, THREE.Mesh>();
  const hitMeshes: THREE.Mesh[] = [];

  const registerChoppablePart = (
    partName: PartName,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos: [number, number, number],
    stumpPos: [number, number, number]
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { dinoId: state.id, partName };
    parent.add(mesh);
    partMeshes.set(partName, mesh);
    hitMeshes.push(mesh);

    // Hidden Glowing Bio-Amber Stump Cap that reveals the instant this part is chopped off!
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.5, 10), bioAmberStumpMat);
    stump.position.set(...stumpPos);
    stump.rotation.x = Math.PI / 2;
    stump.visible = state.parts?.[partName]?.severed || false;
    parent.add(stump);
    stumpMeshes.set(partName, stump);

    if (state.parts?.[partName]?.severed) {
      mesh.visible = false;
    }
    return mesh;
  };

  // Torso & Glowing Bio-Core Chest
  const torso = new THREE.Mesh(new THREE.BoxGeometry(5.5, 6.2, 11.5), skinMat);
  torso.position.set(0, 8.5, 0);
  torso.castShadow = true;
  root.add(torso);

  registerChoppablePart('Bio_Core', new THREE.OctahedronGeometry(2.1, 1), bioAmberStumpMat, torso, [0, -0.5, -2.5], [0, -0.5, -2.0]);
  registerChoppablePart('Back_Plates', new THREE.BoxGeometry(1.6, 3.2, 9.5), armorMat, torso, [0, 4.2, 0], [0, 3.1, 0]);

  // Head & Armored Jaw/Crest
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 12.5, -7.2);
  root.add(headGroup);
  registerChoppablePart('Head_Armor', new THREE.BoxGeometry(4.2, 4.0, 6.8), armorMat, headGroup, [0, 0, -2.2], [0, 0, -0.2]);

  // Articulated Multi-Segment Choppable Tail
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 8.8, 5.8);
  root.add(tailGroup);
  const tailUpper = registerChoppablePart('Tail_Upper', new THREE.BoxGeometry(3.4, 3.2, 7.5), skinMat, tailGroup, [0, 0, 3.5], [0, 0, 0.4]);
  registerChoppablePart('Tail_Tip', new THREE.ConeGeometry(2.1, 8.5, 8).rotateX(Math.PI / 2), armorMat, tailUpper, [0, 0, 7.2], [0, 0, 3.6]);

  // Procedural IK Legs & Choppable Achilles Tendons
  const legL = new THREE.Group();
  legL.position.set(-3.2, 7.0, 0.5);
  const legR = new THREE.Group();
  legR.position.set(3.2, 7.0, 0.5);
  root.add(legL, legR);

  registerChoppablePart('Leg_L_Tendon', new THREE.BoxGeometry(2.1, 7.0, 3.0), skinMat, legL, [0, -3.5, 0], [0, -1.5, 0]);
  registerChoppablePart('Leg_R_Tendon', new THREE.BoxGeometry(2.1, 7.0, 3.0), skinMat, legR, [0, -3.5, 0], [0, -1.5, 0]);

  return { id: state.id, species: state.species, root, partMeshes, stumpMeshes, hitMeshes, legL, legR, tailGroup, headGroup, state };
}

function spawnBioAmberBurst(worldPos: THREE.Vector3) {
  const count = 48;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = worldPos.x;
    positions[i * 3 + 1] = worldPos.y;
    positions[i * 3 + 2] = worldPos.z;
    velocities[i * 3] = (Math.random() - 0.5) * 18;
    velocities[i * 3 + 1] = Math.random() * 16 + 4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 18;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.65, transparent: true, opacity: 1 });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particleBursts.push({ points, vel: velocities, age: 0 });
}

// ====================================================================================================
// 5. HARVESTABLE 3D MEAT / BIO-HEART CHUNKS ON THE GROUND
// ====================================================================================================
const chunkMeshes = new Map<string, THREE.Object3D>();

function chunkModelName(c: HarvestChunk) {
  const id = c.itemId;
  if (id.includes('heart')) return 'Chunk_Heart';
  if (id.includes('skull') || id.includes('crest')) return 'Chunk_Skull';
  if (id.includes('steak') || id.includes('slab') || id.includes('meat')) return 'Chunk_Steak';
  if (id.includes('fin') || id.includes('plume')) return 'Chunk_Plate';
  return 'Chunk_Claw';
}

function syncHarvestChunks(chunks: HarvestChunk[]) {
  const activeIds = new Set(chunks.map(c => c.chunkId));
  for (const [id, mesh] of chunkMeshes.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(mesh);
      chunkMeshes.delete(id);
    }
  }

  for (const c of chunks) {
    let mesh = chunkMeshes.get(c.chunkId);
    if (!mesh) {
      const isWinchCore = c.weightClass === 'WINCH_ONLY';
      const geo = isWinchCore ? new THREE.OctahedronGeometry(1.6, 1) : new THREE.BoxGeometry(2.2, 1.2, 1.5);
      const mat = new THREE.MeshStandardMaterial({
        color: isWinchCore ? 0x00f5d4 : 0xd62828,
        emissive: isWinchCore ? 0x00bbf9 : 0xff5400,
        emissiveIntensity: isWinchCore ? 2.2 : 0.65,
        roughness: 0.35
      });
      const template = propsModel?.getObjectByName(chunkModelName(c));
      mesh = template ? template.clone(true) : new THREE.Mesh(geo, mat);
      if (template && c.itemId.startsWith('raptor')) mesh.scale.setScalar(0.6);
      const tag = { chunkId: c.chunkId, label: c.label, weightClass: c.weightClass };
      mesh.traverse((o) => {
        o.userData = tag;
        o.castShadow = true;
      });
      scene.add(mesh);
      chunkMeshes.set(c.chunkId, mesh);
    }
    mesh.position.set(c.x, c.y, c.z);
    mesh.rotation.y += 0.03;
  }
}

// ====================================================================================================
// 6. PLAYER CONTROLLER, GRAPPLE HOOK CABLE & PLASMA CLEAVER VIEWMODEL
// ====================================================================================================
const playerPos = new THREE.Vector3(9, 2.2, 46); // beside the truck, looking down the road into the jungle
const playerVel = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
let canJump = true;
let flashlightOn = false;
let grappledDinoId: string | null = null;
let grappledPart: PartName | null = null;
let screenShake = 0;
let scannedDinoId = 'titan_rex_1';

// First-Person Plasma Great-Cleaver Blade
const cleaverGroup = new THREE.Group();
camera.add(cleaverGroup);
scene.add(camera);

const bladeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.35, 1.85),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x00f5d4, emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.2 })
);
bladeMesh.position.set(0.55, -0.38, -1.1);
const cleaverModel = propsModel?.getObjectByName('Cleaver');
if (cleaverModel) {
  cleaverModel.position.set(0.5, -0.5, -0.75);
  cleaverModel.rotation.set(0.75, -0.2, -0.3);
  cleaverModel.scale.setScalar(0.6);
  cleaverModel.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  cleaverGroup.add(cleaverModel);
} else {
  cleaverGroup.add(bladeMesh);
}
let swingAnim = 0;

// Pneumatic Grapple Cable Line
const grappleLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const grappleLine = new THREE.Line(grappleLineGeo, new THREE.LineBasicMaterial({ color: 0xff9f1c }));
grappleLine.visible = false;
scene.add(grappleLine);

// Other Co-op Squad Players in Room
const otherPlayerMeshes = new Map<string, THREE.Group>();

// ====================================================================================================
// 7. PARTYKIT REAL-TIME MULTIPLAYER CONNECTION
// ====================================================================================================
const urlParams = new URLSearchParams(window.location.search);
const roomName = urlParams.get('room') || 'jungle-alpha-1';
if (!urlParams.get('room')) {
  window.history.replaceState({}, '', `?room=${roomName}`);
}

const partyHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'localhost:1999'
  : window.location.host;

let myId = 'local_hunter';
const socket = new PartySocket({ host: partyHost, room: roomName });

function showBanner(text: string) {
  const el = document.getElementById('event-banner')!;
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5500);
}

socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'INIT_STATE') {
    myId = msg.selfId;
    setWorldPhaseVisuals(msg.worldPhase);
    // A fresh hunt replaces everything: drop old rigs (and their severed stumps), debris and the grapple
    for (const rig of clientDinos.values()) scene.remove(rig.root);
    clientDinos.clear();
    for (const debris of tumblingDebris) scene.remove(debris.mesh);
    tumblingDebris.length = 0;
    grappledDinoId = null;
    grappledPart = null;
    grappleLine.visible = false;
    const cargo: HarvestChunk[] = msg.truck?.cargoItems || [];
    document.getElementById('cargo-count')!.textContent = String(cargo.length);
    document.getElementById('gold-count')!.textContent = String(cargo.reduce((sum, c) => sum + c.valueGold, 0));
    for (const d of msg.dinos) {
      if (!clientDinos.has(d.id)) {
        clientDinos.set(d.id, buildArticulatedDinoRig(d));
      }
    }
    syncHarvestChunks(msg.chunks || []);
    updateScannerUI();
  }

  if (msg.type === 'PART_DAMAGED') {
    const rig = clientDinos.get(msg.dinoId);
    if (rig) {
      rig.state.hp = msg.dinoHp;
      if (rig.state.parts[msg.part as PartName]) {
        rig.state.parts[msg.part as PartName].hp = msg.partHp;
      }
      scannedDinoId = msg.dinoId;
      updateScannerUI();
    }
  }

  if (msg.type === 'PART_SEVERED') {
    const rig = clientDinos.get(msg.dinoId);
    if (rig) {
      const partName = msg.part as PartName;
      rig.state.parts[partName].severed = true;
      const partMesh = rig.partMeshes.get(partName);
      const stumpMesh = rig.stumpMeshes.get(partName);

      if (partMesh) {
        const worldPos = new THREE.Vector3();
        partMesh.getWorldPosition(worldPos);
        // Clone before hiding so the tumbling copy keeps the dinosaur's size and facing
        partMesh.updateWorldMatrix(true, false);
        const severedClone = partMesh.clone();
        partMesh.matrixWorld.decompose(severedClone.position, severedClone.quaternion, severedClone.scale);
        partMesh.visible = false;

        // 1. Reveal Glowing Bio-Amber Stump Cap on the Dinosaur
        if (stumpMesh) stumpMesh.visible = true;

        // 2. Spawn Glowing Bio-Amber Particle Spray
        spawnBioAmberBurst(worldPos);
        screenShake = 0.85;

        // 3. Spawn Tumbling 3D Physics Severed Limb
        scene.add(severedClone);
        tumblingDebris.push({
          mesh: severedClone,
          vel: new THREE.Vector3((Math.random() - 0.5) * 14, 14, (Math.random() - 0.5) * 14),
          rotVel: new THREE.Vector3(4, 3, -5),
          age: 0
        });
      }
      showBanner(`🪓 ${msg.choppedBy} SEVERED ${partName.toUpperCase()}! Collect the dropped part!`);
      updateScannerUI();
    }
  }

  if (msg.type === 'ECLIPSE_NIGHTFALL_STARTED') {
    setWorldPhaseVisuals('ECLIPSE_NIGHTFALL');
    flashlightOn = true;
    for (const d of msg.dinos) {
      if (!clientDinos.has(d.id)) {
        clientDinos.set(d.id, buildArticulatedDinoRig(d));
      }
    }
    showBanner(msg.message);
  }

  if (msg.type === 'CARCASS_SLICED') {
    showBanner(`🥩 CARCASS BUTCHERED! Spawned ${msg.chunk.label} (${msg.remaining} cuts left)`);
  }

  if (msg.type === 'WINCH_ATTACHED') {
    showBanner(`🪝 TOW-WINCH ATTACHED TO ${msg.label}! Reeling into Harvester Truck...`);
  }

  if (msg.type === 'CHUNK_LOADED_TRUCK') {
    document.getElementById('cargo-count')!.textContent = String(msg.truckCargoCount);
    document.getElementById('gold-count')!.textContent = String(msg.totalGoldValue);
    showBanner(`🚛 LOADED INTO HARVESTER TRUCK! Total Haul: ${msg.totalGoldValue} Gold`);
  }

  if (msg.type === 'FEAST_COOKED') {
    showBanner(msg.message);
  }

  if (msg.type === 'WORLD_TICK') {
    // Sync Dinosaurs
    for (const d of msg.dinos) {
      let rig = clientDinos.get(d.id);
      if (rig) {
        rig.state.x = d.x;
        rig.state.z = d.z;
        rig.state.rotY = d.rotY;
        rig.state.hp = d.hp;
        rig.state.aiState = d.aiState;
      }
    }

    // Sync Harvester Truck & Tow-Winch Line
    if (msg.truck) {
      truckGroup.position.set(msg.truck.x, 0, msg.truck.z);
      truckGroup.rotation.y = msg.truck.rotY;
      truckBeams.forEach((beam) => { beam.intensity = msg.truck.headlightsOn ? 90 : 0; });
      if (msg.truck.winchTargetChunkId) {
        const targetMesh = chunkMeshes.get(msg.truck.winchTargetChunkId);
        if (targetMesh) {
          winchLine.visible = true;
          winchLineGeo.setFromPoints([
            new THREE.Vector3(msg.truck.x, 2.5, msg.truck.z),
            targetMesh.position.clone()
          ]);
        }
      } else {
        winchLine.visible = false;
      }
    }

    // Sync Severed Chunks on Ground
    syncHarvestChunks(msg.chunks || []);

    // Sync Co-op Squad Teammates
    const activePeers = new Set<string>();
    for (const p of msg.players) {
      if (p.id === myId) continue;
      activePeers.add(p.id);
      let peerMesh = otherPlayerMeshes.get(p.id);
      if (!peerMesh) {
        peerMesh = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.6, 1.4, 4, 8),
          new THREE.MeshStandardMaterial({ color: 0x00f5d4, roughness: 0.3 })
        );
        body.position.y = 1.3;
        const hunter = propsModel?.getObjectByName('Hunter');
        if (hunter) {
          const figure = hunter.clone(true);
          figure.scale.setScalar(1.12);
          figure.position.y = -2.2; // player positions are eye height; the model stands on its feet
          peerMesh.add(figure);
        } else {
          peerMesh.add(body);
        }
        scene.add(peerMesh);
        otherPlayerMeshes.set(p.id, peerMesh);
      }
      peerMesh.position.set(p.x, p.y, p.z);
      peerMesh.rotation.y = p.rotY;
    }
    for (const [id, m] of otherPlayerMeshes.entries()) {
      if (!activePeers.has(id)) {
        scene.remove(m);
        otherPlayerMeshes.delete(id);
      }
    }
  }
});

function setWorldPhaseVisuals(phase: string) {
  const badge = document.getElementById('phase-badge')!;
  if (phase === 'ECLIPSE_NIGHTFALL') {
    scene.background = new THREE.Color(0x05070e);
    scene.fog = new THREE.FogExp2(0x090d1a, 0.018);
    sunLight.intensity = 0.15;
    sunLight.color.setHex(0xff2a5f);
    hemiLight.intensity = 0.12;
    scene.environmentIntensity = 0.05;
    skyMat.uniforms.night.value = 1;
    cloudLayer.visible = false;
    moteMat.color.setHex(0x7dffb0);
    moteMat.size = 0.34;
    bloomPass.strength = 0.9;
    skyMat.uniforms.top.value.setHex(0x010208);
    skyMat.uniforms.horizon.value.setHex(0x090d1a);
    badge.textContent = '🌑 PHASE 2: BLOOD ECLIPSE EXTRACTION (STALKERS ACTIVE)';
    badge.classList.add('phase-eclipse');
  } else {
    scene.background = new THREE.Color(0x87b8d4);
    scene.fog = new THREE.FogExp2(0x87b8d4, 0.0065);
    sunLight.intensity = 2.4;
    sunLight.color.setHex(0xfff1d0);
    hemiLight.intensity = 0.85;
    scene.environmentIntensity = 0.4;
    skyMat.uniforms.night.value = 0;
    cloudLayer.visible = true;
    moteMat.color.setHex(0xfff2b0);
    moteMat.size = 0.22;
    bloomPass.strength = 0.55;
    skyMat.uniforms.top.value.setHex(0x4f95d0);
    skyMat.uniforms.horizon.value.setHex(0x87b8d4);
    badge.textContent = '☀️ PHASE 1: DAYTIME TITAN HUNT';
    badge.classList.remove('phase-eclipse');
  }
}

function updateScannerUI() {
  const rig = clientDinos.get(scannedDinoId) || clientDinos.values().next().value;
  if (!rig) return;
  const s = rig.state;
  document.getElementById('scan-dino-name')!.textContent =
    s.species === 'voltaic_rex' ? 'VOLTAIC BIO-REX (60 FT)' :
    s.species === 'stego_titan' ? 'OBSIDIAN STEGO-TITAN (65 FT)' : 'SHADOW RAPTOR STALKER';
  document.getElementById('scan-dino-hp')!.textContent =
    s.aiState === 'DEAD_CARCASS' ? 'CARCASS — HOLD CLICK TO SAW!' : `${s.hp} / ${s.maxHp} HP`;
  document.getElementById('scan-hp-bar')!.style.width = `${(s.hp / s.maxHp) * 100}%`;

  const grid = document.getElementById('parts-grid')!;
  grid.innerHTML = '';
  for (const part of Object.values(s.parts || {})) {
    const div = document.createElement('div');
    div.className = 'part-pill' + (part.severed ? ' part-severed' : '');
    div.innerHTML = `<span>${part.label}</span><span>${part.severed ? 'SEVERED' : part.hp + ' HP'}</span>`;
    grid.appendChild(div);
  }
}

// ====================================================================================================
// 8. INPUT HANDLING: RAYCAST PART-CHOPPING, GRAPPLE HOOK & SANCTUARY BUTTONS
// ====================================================================================================
const keys: Record<string, boolean> = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyF') flashlightOn = !flashlightOn;
  if (e.code === 'KeyQ') fireGrappleHook();
  if (e.code === 'KeyE') interactPickupOrWinch();
  if (e.code === 'KeyR') {
    // Drive Harvester Truck closer to Sanctuary or player
    socket.send(JSON.stringify({
      type: 'DRIVE_TRUCK',
      x: playerPos.x,
      z: playerPos.z + 5,
      rotY: yaw,
      headlightsOn: true
    }));
    showBanner('🚛 Harvester Truck driven to your position! Walk carrying meat near the flatbed to load.');
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  } else {
    performCleaverChop();
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  fireGrappleHook();
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch - e.movementY * 0.0022));
  }
});

const raycaster = new THREE.Raycaster();

function getCrosshairHit() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets: THREE.Object3D[] = [];
  for (const rig of clientDinos.values()) {
    for (const m of rig.hitMeshes) {
      if (isShown(m)) targets.push(m);
    }
  }
  for (const chunk of chunkMeshes.values()) {
    chunk.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) targets.push(o);
    });
  }
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0] : null;
}

function performCleaverChop() {
  swingAnim = 1.0;
  const hit = getCrosshairHit();
  if (!hit || hit.distance > 22) return;

  const { dinoId, partName } = hit.object.userData;
  if (dinoId && partName) {
    const rig = clientDinos.get(dinoId);
    if (!rig) return;
    scannedDinoId = dinoId;

    if (rig.state.aiState === 'DEAD_CARCASS') {
      socket.send(JSON.stringify({ type: 'SAW_CARCASS', dinoId }));
    } else {
      socket.send(JSON.stringify({ type: 'CHOP_PART', dinoId, part: partName, damage: 240 }));
    }
    spawnBioAmberBurst(hit.point);
    screenShake = 0.25;
  }
}

function fireGrappleHook() {
  if (grappledDinoId) {
    grappledDinoId = null;
    grappledPart = null;
    grappleLine.visible = false;
    return;
  }
  const hit = getCrosshairHit();
  if (hit && hit.object.userData.dinoId && hit.distance < 95) {
    grappledDinoId = hit.object.userData.dinoId;
    grappledPart = hit.object.userData.partName;
    playerVel.y = 14;
    showBanner(`🪝 GRAPPLED ONTO ${grappledPart}! Aim & Left-Click to saw it off!`);
  }
}

function interactPickupOrWinch() {
  const hit = getCrosshairHit();
  if (hit && hit.object.userData.chunkId && hit.distance < 16) {
    socket.send(JSON.stringify({ type: 'PICKUP_CHUNK', chunkId: hit.object.userData.chunkId }));
  }
}

// HUD Button Listeners
document.getElementById('btn-invite')!.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);
  showBanner('🔗 Squad Invite Link Copied! Send to friends to drop straight into this Jungle Hunt!');
});

let ultraGfx = true;
document.getElementById('btn-gfx')!.addEventListener('click', (e) => {
  ultraGfx = !ultraGfx;
  renderer.setPixelRatio(ultraGfx ? Math.min(window.devicePixelRatio, 2) : 0.8);
  motes.visible = ultraGfx;
  renderer.shadowMap.enabled = ultraGfx;
  groundCover.forEach((m) => { m.visible = ultraGfx; });
  (e.target as HTMLButtonElement).textContent = ultraGfx
    ? '✨ GRAPHICS: ULTRA (WebGPU/PBR)'
    : '⚡ GRAPHICS: PERFORMANCE (Mobile 60FPS)';
});

document.getElementById('btn-cook')!.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'COOK_STEAK_FEAST' }));
});

document.getElementById('btn-extract')!.addEventListener('click', async () => {
  const gold = Number(document.getElementById('gold-count')!.textContent || 0);
  showBanner(`✅ EXTRACTED TO SANCTUARY! Saved ${gold} Gold & Chopped Dino Parts to Cloudflare D1!`);
});

document.getElementById('btn-new-hunt')!.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'NEW_EXPEDITION' }));
});

// ====================================================================================================
// 9. MAIN 60FPS RENDER, PROCEDURAL IK ANIMATION & PHYSICS LOOP
// ====================================================================================================
let lastTime = performance.now();
let netSyncTimer = 0;
let devFreeCam = false;

if (import.meta.env.DEV) {
  // Dev-only helpers for inspecting models from the browser console
  Object.assign(window, {
    __dinos: clientDinos,
    __view: (x: number, y: number, z: number, newYaw = 0, newPitch = 0) => {
      playerPos.set(x, y, z);
      yaw = newYaw;
      pitch = newPitch;
      devFreeCam = true;
    }
  });
}

function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // 1. Player Movement or Grapple Reel-In Physics
  const speed = keys['ShiftLeft'] ? 18 : 11;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  if (grappledDinoId) {
    const rig = clientDinos.get(grappledDinoId);
    const partMesh = rig && grappledPart ? rig.partMeshes.get(grappledPart) : null;
    if (rig && partMesh && isShown(partMesh)) {
      const targetPos = new THREE.Vector3();
      partMesh.getWorldPosition(targetPos);
      targetPos.y += 2.8;
      playerPos.lerp(targetPos, dt * 5.5);
      grappleLine.visible = true;
      grappleLineGeo.setFromPoints([
        new THREE.Vector3(playerPos.x, playerPos.y - 0.5, playerPos.z),
        targetPos
      ]);
    } else {
      grappledDinoId = null;
      grappleLine.visible = false;
    }
  } else {
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(forward);
    if (keys['KeyS']) move.sub(forward);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    playerPos.add(move);

    if (keys['Space'] && canJump) {
      playerVel.y = 11.5;
      canJump = false;
    }
    if (!devFreeCam) playerVel.y -= 26 * dt;
    playerPos.y += playerVel.y * dt;
    const eyeHeight = groundHeight(playerPos.x, playerPos.z) + 2.2;
    if (playerPos.y <= eyeHeight && !devFreeCam) {
      playerPos.y = eyeHeight;
      playerVel.y = 0;
      canJump = true;
    }
  }

  // 2. Camera Transform & Footstep Screen Shake
  camera.position.copy(playerPos);
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    screenShake = Math.max(0, screenShake - dt * 2.5);
  }
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  skyDome.position.copy(camera.position);

  // Helmet Flashlight Update
  flashlight.intensity = flashlightOn ? 70 : 0;
  flashlight.position.copy(camera.position);
  flashlight.target.position.copy(camera.position).add(forward.clone().multiplyScalar(20));

  // Cleaver Swing Animation
  if (swingAnim > 0) {
    swingAnim = Math.max(0, swingAnim - dt * 5.5);
    cleaverGroup.rotation.x = -Math.sin(swingAnim * Math.PI) * 1.15;
    cleaverGroup.rotation.z = Math.sin(swingAnim * Math.PI) * 0.45;
  }

  // 3. Procedural Dinosaur IK Walk Cycle, Tail Sway & Carcass Collapse
  const lerp = THREE.MathUtils.lerp;
  const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const rig of clientDinos.values()) {
    const root = rig.root;
    const prevX = root.position.x;
    const prevZ = root.position.z;
    root.position.x = lerp(prevX, rig.state.x, dt * 6);
    root.position.z = lerp(prevZ, rig.state.z, dt * 6);
    const groundY = groundHeight(root.position.x, root.position.z);
    const size = root.scale.x;
    const speed = Math.hypot(root.position.x - prevX, root.position.z - prevZ) / Math.max(dt, 1e-4);
    const gait = (rig.gait = lerp(rig.gait ?? 0, Math.min(speed / 2, 1), dt * 4));
    const phase = (rig.phase = (rig.phase ?? 0) + dt * (rig.species === 'shadow_raptor' ? 11 : 4.5) * gait);

    if (rig.state.aiState === 'DEAD_CARCASS') {
      // Collapse the carcass onto its side for harvesting
      root.rotation.x = lerp(root.rotation.x, 0, dt * 4);
      root.rotation.z = lerp(root.rotation.z, Math.PI / 2.2, dt * 4);
      root.position.y = lerp(root.position.y, groundY - 2.2 * size, dt * 4);
    } else {
      const staggered = rig.state.aiState === 'STAGGERED';
      const parts = rig.state.parts;
      const limp = (parts?.Leg_L_Tendon?.severed ? 1 : 0) - (parts?.Leg_R_Tendon?.severed ? 1 : 0);

      // Weight shift, a limp towards a cut tendon, and a forward slump while staggered
      root.rotation.z = lerp(root.rotation.z, limp * 0.13 + Math.sin(phase) * 0.035 * gait, dt * 5);
      root.rotation.x = lerp(root.rotation.x, staggered ? 0.17 : 0, dt * 3);
      root.rotation.y += wrapAngle(rig.state.rotY + Math.PI - root.rotation.y) * Math.min(1, dt * 5);
      const stride = Math.abs(Math.cos(phase)) * 0.4 * size * gait;
      root.position.y = lerp(root.position.y, groundY + stride - (staggered ? 0.9 * size : 0), dt * 8);

      const swing = Math.sin(phase) * 0.5 * gait;
      rig.legL.rotation.x = swing;
      rig.legR.rotation.x = -swing;
      if (rig.frontLegL) rig.frontLegL.rotation.x = -swing * 0.85;
      if (rig.frontLegR) rig.frontLegR.rotation.x = swing * 0.85;
      rig.tailGroup.rotation.y = Math.cos(phase * 0.8) * 0.3 * gait + Math.sin(now * 0.0011 + rig.state.x) * 0.12;
      rig.tailGroup.rotation.x = Math.sin(now * 0.0008 + rig.state.z) * 0.05;

      // The head bobs with the stride and tracks the nearest hunter when they get close
      const toPlayerX = playerPos.x - root.position.x;
      const toPlayerZ = playerPos.z - root.position.z;
      const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);
      const lookYaw = distToPlayer < 70
        ? THREE.MathUtils.clamp(wrapAngle(Math.atan2(toPlayerX, toPlayerZ) - rig.state.rotY), -0.65, 0.65)
        : 0;
      rig.headGroup.rotation.y = lerp(rig.headGroup.rotation.y, lookYaw, dt * 2.5);
      rig.headGroup.rotation.x = Math.sin(phase * 2) * 0.06 * gait + Math.sin(now * 0.0013 + rig.state.x) * 0.04;

      // Earth tremor on each footfall when a Titan walks nearby
      if (rig.species !== 'shadow_raptor' && distToPlayer < 32 && gait > 0.3 && Math.abs(Math.sin(phase)) > 0.97) {
        screenShake = Math.max(screenShake, (32 - distToPlayer) * 0.009);
      }
    }
  }

  // 4. Tumbling Severed 3D Limbs & Bio-Amber Particle Physics
  for (let i = tumblingDebris.length - 1; i >= 0; i--) {
    const d = tumblingDebris[i];
    d.age += dt;
    if (d.age > 30) { // severed limbs sink away after a while instead of piling up forever
      scene.remove(d.mesh);
      tumblingDebris.splice(i, 1);
      continue;
    }
    d.vel.y -= 24 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.rotVel.x * dt;
    d.mesh.rotation.z += d.rotVel.z * dt;
    if (d.mesh.position.y < 1.0) {
      d.mesh.position.y = 1.0;
      d.vel.y *= -0.35;
      d.vel.x *= 0.8;
      d.vel.z *= 0.8;
      d.rotVel.multiplyScalar(0.7);
    }
  }

  for (let i = particleBursts.length - 1; i >= 0; i--) {
    const b = particleBursts[i];
    b.age += dt;
    const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < pos.count; j++) {
      b.vel[j * 3 + 1] -= 22 * dt;
      pos.setXYZ(
        j,
        pos.getX(j) + b.vel[j * 3] * dt,
        Math.max(0.2, pos.getY(j) + b.vel[j * 3 + 1] * dt),
        pos.getZ(j) + b.vel[j * 3 + 2] * dt
      );
    }
    pos.needsUpdate = true;
    (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age * 0.9);
    if (b.age > 1.2) {
      scene.remove(b.points);
      particleBursts.splice(i, 1);
    }
  }

  // 5. Crosshair Target Inspection Prompt
  const hit = getCrosshairHit();
  const promptEl = document.getElementById('target-prompt')!;
  if (hit && hit.distance < 28) {
    if (hit.object.userData.partName) {
      const rig = clientDinos.get(hit.object.userData.dinoId);
      if (rig?.state.aiState === 'DEAD_CARCASS') {
        promptEl.textContent = '🥩 [LEFT-CLICK] Saw Fallen Carcass into Carryable Meat / Bio-Heart';
      } else {
        promptEl.textContent = `🪓 [LEFT-CLICK] Chop ${hit.object.userData.partName} • [Q / RIGHT-CLICK] Grapple`;
      }
    } else if (hit.object.userData.chunkId) {
      promptEl.textContent = `📦 [PRESS E] ${hit.object.userData.weightClass === 'WINCH_ONLY' ? 'Attach Truck Tow-Winch' : 'Pick Up'} ${hit.object.userData.label}`;
    }
  } else {
    promptEl.textContent = grappledDinoId
      ? `🪝 GRAPPLED ONTO DINOSAUR! [LEFT-CLICK] Chop Limb • [Q] Detach`
      : 'Aim at Giant Dinosaur Limb to Chop or [Q] Grapple onto Back';
  }

  // 6. Send Player Position to PartyKit Server at 20Hz
  netSyncTimer += dt;
  if (netSyncTimer >= 0.05 && socket.readyState === WebSocket.OPEN) {
    netSyncTimer = 0;
    socket.send(JSON.stringify({
      type: 'SYNC_PLAYER',
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
      rotY: yaw,
      grappledDinoId,
      grappledPart,
      flashlightOn
    }));
  }

  // Rotate Cozy Spit-Roast Steak at Sanctuary Camp
  // Ambient life: wind, clouds, motes around the player, campfire embers
  windTime.value = now / 1000;
  cloudLayer.rotation.y += dt * 0.004;
  const motePos = moteGeo.attributes.position as THREE.BufferAttribute;
  const t = now / 1000;
  for (let i = 0; i < MOTES; i++) {
    const sx = moteSeeds[i * 3], sy = moteSeeds[i * 3 + 1], sz = moteSeeds[i * 3 + 2];
    // Each mote lives in a 110-unit cell that wraps around the player
    const wx = ((sx * 110 + t * (0.3 + sy) - playerPos.x) % 110 + 110) % 110 - 55;
    const wz = ((sz * 110 + t * (0.2 + sx * 0.5) - playerPos.z) % 110 + 110) % 110 - 55;
    motePos.setXYZ(i, playerPos.x + wx, 0.6 + sy * 9 + Math.sin(t * (0.5 + sx) + i) * 0.6, playerPos.z + wz);
  }
  motePos.needsUpdate = true;
  const emberPos = emberGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < EMBERS; i++) {
    const life = (t * 0.35 + i / EMBERS) % 1;
    emberPos.setXYZ(i, Math.sin(i * 12.9 + life * 4) * (0.3 + life * 0.9), 0.8 + life * 6.5, Math.cos(i * 7.3 + life * 3) * (0.3 + life * 0.9));
  }
  emberPos.needsUpdate = true;

  spitSpinner.rotation.x += dt * 1.5;
  fireLight.intensity = 6 + Math.sin(now * 0.013) * 1.2 + Math.sin(now * 0.031) * 0.8;

  if (ultraGfx) composer.render();
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(animate);
