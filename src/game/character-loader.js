import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let loader;
// Detect the actual GPU's supported target texture formats; never assume desktop capabilities.
export function configureCharacterRenderer(renderer) {
  if (loader) return;
  const textures = new KTX2Loader().setTranscoderPath('/decoders/basis/').setWorkerLimit(1).detectSupport(renderer);
  loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(textures);
  window.addEventListener('pagehide', () => textures.dispose(), { once: true });
}

export function characterLoader() {
  if (!loader) throw new Error('Configure the character loader with the active WebGLRenderer before loading avatars.');
  return loader;
}
