import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Rigged, animated glTF characters (Quaternius, CC0). Loaded once, cloned
// per NPC/remote player via SkeletonUtils so skeletons stay independent.
const MODEL_URLS = {
  character: '/models/Character.glb',       // stylized humanoid (villagers, players)
  cyber:     '/models/CharacterCyber.glb',  // sci-fi explorer
  robot:     '/models/Robot.glb',           // builder-bot
  knight:    '/models/Knight.glb',
  trex:      '/models/Trex.glb',
  raptor:    '/models/Velociraptor.glb',
  trice:     '/models/Triceratops.glb',
  stego:     '/models/Stegosaurus.glb',
  para:      '/models/Parasaurolophus.glb',
  apato:     '/models/Apatosaurus.glb',
};

const _lib = new Map(); // name -> { scene, animations }
let _loading = null;

export function loadModels() {
  if (_loading) return _loading;
  const loader = new GLTFLoader();
  // each model loads independently: one failed fetch falls back to a blocky
  // avatar for that character only, never for the whole cast
  _loading = Promise.all(Object.entries(MODEL_URLS).map(([name, url]) =>
    loader.loadAsync(url).then(
      gltf => _lib.set(name, gltf),
      err => console.warn(`model ${name} failed, blocky fallback for it`, err),
    ),
  )).then(() => _lib.size > 0);
  return _loading;
}

export function modelsReady() {
  return _lib.size === Object.keys(MODEL_URLS).length;
}

// pick the clip whose (prefix-stripped) name contains `word`; shortest wins
// so "Idle" beats "Idle_Gun_Pointing" and "Walk" beats "Walk_Holding".
function findClip(clips, word) {
  const w = word.toLowerCase();
  const hits = clips.filter(c => c.name.split('|').pop().toLowerCase().includes(w));
  hits.sort((a, b) => a.name.length - b.name.length);
  return hits[0] || null;
}

// Spawn an animated instance. Returns null until loadModels() resolves.
// { group, update(dt), play(word), playOnce(word) }
export function spawnModel(name, { height = 1.8, tint = null } = {}) {
  const gltf = _lib.get(name);
  if (!gltf) return null;

  const model = SkeletonUtils.clone(gltf.scene);
  // skinned bounds: raw geometry is cm-scale with the x100 baked into bone
  // matrices, so Box3.setFromObject lies. computeBoundingBox() respects the
  // current skeleton pose and gives the real silhouette.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse(o => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    } else if (o.isMesh) {
      box.expandByObject(o);
    }
  });
  const size = box.getSize(new THREE.Vector3());
  const s = height / (size.y || 1);
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s; // feet on ground

  const tintColor = tint ? new THREE.Color(tint) : null;
  model.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // skinned bounds lag the skeleton; avoid pop-out
    if (tintColor && o.material?.color) {
      o.material = o.material.clone();
      o.material.color.multiply(tintColor);
    }
    // gltf metalness without an env map renders black; these are stylized
    // flat-color models, so kill it (shared material: same fix everywhere)
    if (o.material && 'metalness' in o.material) o.material.metalness = 0;
  });

  const group = new THREE.Group();
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  let current = null;
  let currentWord = '';

  function play(word) {
    if (word === currentWord) return;
    const clip = findClip(gltf.animations, word);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    next.reset().setLoop(THREE.LoopRepeat).fadeIn(0.25).play();
    if (current) current.fadeOut(0.25);
    current = next;
    currentWord = word;
  }

  // one-shot (wave/dance/attack) then back to whatever loops
  function playOnce(word) {
    const clip = findClip(gltf.animations, word);
    if (!clip) return;
    const back = currentWord;
    const act = mixer.clipAction(clip);
    act.reset().setLoop(THREE.LoopOnce).clampWhenFinished = false;
    act.fadeIn(0.15).play();
    if (current) current.fadeOut(0.15);
    current = act; currentWord = '#' + word;
    const onDone = (e) => {
      if (e.action !== act) return;
      mixer.removeEventListener('finished', onDone);
      currentWord = '';
      play(back || 'Idle');
    };
    mixer.addEventListener('finished', onDone);
  }

  play('Idle');
  return { group, play, playOnce, update: (dt) => mixer.update(dt) };
}
