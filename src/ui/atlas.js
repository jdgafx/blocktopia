import { TextureLoader } from '../engine/texture-loader.js';
import * as THREE from 'three';

export const ATLAS_URL = '/textures/natural-atlas.png';

export function buildAtlas() {
  const texture = new TextureLoader().load(ATLAS_URL);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
