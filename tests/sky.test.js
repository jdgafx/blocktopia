import { it, expect } from 'vitest';
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { createSky, updateSky } from '../src/engine/sky.js';

it('keeps the atmosphere centered on distant journeys and aligned with the light', () => {
  const scene = new Scene(), camera = new PerspectiveCamera();
  const sky = createSky(scene), sun = new Vector3(0.3, 0.8, 0.4).normalize();
  camera.position.set(10000, 35, -10000);
  updateSky(sky, camera, sun, 0.8);
  expect(sky.position.equals(camera.position)).toBe(true);
  expect(sky.material.uniforms.sunPosition.value.equals(sun)).toBe(true);
  expect(sky.visible).toBe(true);
  updateSky(sky, camera, sun, 0);
  expect(sky.visible).toBe(false);
  sky.geometry.dispose(); sky.material.dispose();
});
