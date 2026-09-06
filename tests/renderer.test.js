import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Renderer } from '../src/engine/renderer.js';

function lightingRig() {
  const rig = Object.create(Renderer.prototype);
  rig.renderer = { setPixelRatio: vi.fn() };
  rig.scene = new THREE.Scene(); rig.scene.background = new THREE.Color();
  rig.camera = new THREE.PerspectiveCamera();
  rig._setupLighting();
  return rig;
}

describe('lighting quality and shadow stability', () => {
  it('bounds GPU quality, disposes resized maps, and keeps fog within loaded terrain', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    try {
      const rig = lightingRig();
      rig.setQuality('balanced');
      expect(rig.sunLight.shadow.mapSize.toArray()).toEqual([1024, 1024]);
      expect(rig.renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5);
      expect(rig.scene.fog.far).toBe(64);
      const dispose = vi.fn(); rig.sunLight.shadow.map = { dispose };
      rig.setQuality('high');
      expect(dispose).toHaveBeenCalledOnce();
      expect(rig.sunLight.shadow.map).toBeNull();
      expect(rig.sunLight.shadow.mapSize.toArray()).toEqual([2048, 2048]);
      expect(rig.renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
      expect(rig.scene.fog.far).toBe(96);
      expect(rig.sunLight.shadow.camera.right).toBe(40);
      rig.setQuality('high');
      expect(dispose).toHaveBeenCalledOnce();
      expect(() => rig.setQuality('ultra')).toThrow(RangeError);
    } finally { vi.unstubAllGlobals(); }
  });

  it('snaps the following shadow origin to light-space texels in every day phase', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    try {
      const rig = lightingRig(); rig.setQuality('balanced'); rig.setLighting('cycle');
      for (const quality of ['balanced', 'high']) {
        rig.setQuality(quality);
        for (const now of [0, 300000, 600000, 900000, 1199999]) {
          rig.camera.position.set(173.127, 43.61, -209.457);
          rig._updateLighting(now);
          const target = rig.sunLight.target.position;
          const texel = rig._shadowExtent * 2 / rig.sunLight.shadow.mapSize.x;
          for (const axis of [rig._shadowRight, rig._shadowUp]) {
            const coordinate = target.dot(axis) / texel;
            expect(coordinate).toBeCloseTo(Math.round(coordinate), 7);
          }
          expect(rig.sunLight.position.distanceTo(target)).toBeCloseTo(100, 8);
          expect(target.distanceTo(new THREE.Vector3(173.127, 37.61, -209.457))).toBeLessThan(texel);
          expect(rig.sunLight.intensity).toBeGreaterThan(0);
          expect(rig.scene.fog.color.equals(rig.scene.background)).toBe(true);
        }
      }
    } finally { vi.unstubAllGlobals(); }
  });
});


it('starts in readable daylight and exposes bounded brightness without changing simulation time', () => {
  const rig = lightingRig();
  rig._shadowExtent = 24;
  rig.scene.fog = new THREE.Fog(0, 16, 32);
  rig._updateLighting(300000);
  const daytime = rig.sunLight.intensity;
  const dayEnvironment = rig.scene.environmentIntensity;
  rig._updateLighting(900000);
  expect(rig.sunLight.intensity).toBe(daytime);
  expect(rig.hemisphere.intensity).toBeGreaterThan(1.8);
  rig.setLighting('cycle'); rig._updateLighting(900000);
  expect(rig.hemisphere.intensity).toBeGreaterThanOrEqual(1.35);
  expect(rig.sunLight.intensity).toBeLessThan(daytime);
  expect(rig.scene.environmentIntensity).toBeCloseTo(0.2);
  expect(rig.scene.environmentIntensity).toBeLessThan(dayEnvironment);
  rig.setBrightness(1.5); expect(rig.renderer.toneMappingExposure).toBe(1.5);
  expect(() => rig.setBrightness(NaN)).toThrow(RangeError);
  expect(() => rig.setBrightness(4)).toThrow(RangeError);
  expect(() => rig.setLighting('invalid')).toThrow(RangeError);
});
