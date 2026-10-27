import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { uniform } from 'three/tsl';

export function createSky(scene) {
  const sky = new SkyMesh();
  sky.scale.setScalar(10000);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.turbidity.value = 3;
  sky.rayleigh.value = 2;
  sky.mieCoefficient.value = 0.003;
  sky.mieDirectionalG.value = 0.8;
  sky.skyOpacity = uniform(1);
  sky.material.transparent = true;
  sky.material.opacityNode = sky.skyOpacity;
  scene.add(sky);
  return sky;
}

export function updateSky(sky, camera, sunDirection, daylight) {
  // Keep the distant atmosphere centered during long journeys.
  sky.position.copy(camera.position);
  sky.sunPosition.value.copy(sunDirection);
  const fade = Math.min(1, Math.max(0, daylight / 0.12));
  sky.skyOpacity.value = fade * fade * (3 - 2 * fade);
  // The existing moonlit background supplies readable nights.
  sky.visible = daylight > 0;
}
