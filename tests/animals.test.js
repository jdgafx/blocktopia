import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildAnimal } from '../src/game/animals.js';

it('builds distinct grounded species with finite geometry, three triceratops horns and independent animation joints', () => {
  const skins = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
  for (const longneck of [true, false]) {
    const animal = buildAnimal(longneck, skins), other = buildAnimal(longneck, skins);
    expect(animal.userData.legs).toHaveLength(4);
    expect(animal.userData.legs.every(leg => leg.isGroup)).toBe(true);
    animal.userData.legs[0].rotation.x = .2;
    expect(other.userData.legs[0].rotation.x).toBeCloseTo(0);
    expect(animal.userData.legs.map(leg => leg.userData.gaitPhase)).toEqual([0, Math.PI, Math.PI, 0]);
    animal.userData.legs[0].rotation.x = 0;
    let triangles = 0, skinParts = 0, horns = 0;
    animal.traverse(part => {
      if (part.name.includes('horn')) horns++;
      if (!part.isMesh) return;
      const { geometry } = part;
      triangles += geometry.index.count / 3;
      if (part.material === skins[longneck ? 0 : 1]) skinParts++;
      for (const key of ['position', 'normal', 'uv']) expect([...geometry.attributes[key].array].every(Number.isFinite)).toBe(true);
      expect(geometry.attributes.position.count).toBe(geometry.attributes.uv.count);
    });
    expect(horns).toBe(longneck ? 0 : 3);
    expect(skinParts).toBeGreaterThanOrEqual(7);
    expect(triangles).toBeLessThan(18000);
    const bounds = new THREE.Box3().setFromObject(animal);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.min.y).toBeLessThan(.1);
    expect(bounds.max.y).toBeGreaterThan(longneck ? 4 : 2.5);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(5);
    expect(animal.userData.head.isGroup).toBe(true);
    expect(animal.userData.tail.isGroup).toBe(true);
  }
});
