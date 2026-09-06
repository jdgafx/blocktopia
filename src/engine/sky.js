import { Sky } from 'three/addons/objects/Sky.js';

export function createSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3;
  uniforms.rayleigh.value = 2;
  uniforms.mieCoefficient.value = 0.003;
  uniforms.mieDirectionalG.value = 0.8;
  uniforms.skyOpacity = { value: 1 };
  sky.material.transparent = true;
  sky.material.fragmentShader = `uniform float skyOpacity;\n${sky.material.fragmentShader}`
    .replace('vec4( retColor, 1.0 )', 'vec4( retColor, skyOpacity )');
  scene.add(sky);
  return sky;
}

export function updateSky(sky, camera, sunDirection, daylight) {
  // Keep the distant atmosphere centered during long journeys.
  sky.position.copy(camera.position);
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  const fade = Math.min(1, Math.max(0, daylight / 0.12));
  sky.material.uniforms.skyOpacity.value = fade * fade * (3 - 2 * fade);
  // The existing moonlit background supplies readable nights.
  sky.visible = daylight > 0;
}
