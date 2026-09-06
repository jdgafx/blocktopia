import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBlockbenchCharacter, Characters } from '../src/game/characters.js';

it('loads all editable NPC sources with correct scale, costume, pivots and independent interaction', () => {
  const bounds = new THREE.Box3();
  for (const [id, costume] of [['mara','hearth_apron'], ['ivo','scholar_book'], ['neri','rucksack'], ['sol','lantern_glass']]) {
    const model = JSON.parse(readFileSync(new URL(`../public/models/characters/${id}.bbmodel`, import.meta.url)));
    expect(model.textures[0].source).toMatch(/^data:image\/png;base64,iVBOR/);
    const root = buildBlockbenchCharacter(model, new THREE.MeshLambertMaterial());
    expect(model.elements.some(element => element.name === costume)).toBe(true);
    const meshes = []; root.traverse(part => { if (part.isMesh) meshes.push(part); });
    expect(meshes).toHaveLength(4);
    expect(meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count, 0)).toBe(model.elements.length * 36);
    bounds.setFromObject(root);
    expect(bounds.min.y).toBeCloseTo(.005, 3);
    expect(bounds.max.y).toBeGreaterThan(2.2);
    expect(bounds.max.y).toBeLessThan(2.4);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1.4);
    const arm = root.getObjectByName('left_arm_geometry');
    const positions = arm.geometry.attributes.position;
    const fingertip = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1);
    const before = arm.localToWorld(fingertip.clone());
    root.userData.leftArm.rotation.z = .2;
    expect(arm.localToWorld(fingertip.clone()).distanceTo(before)).toBeGreaterThan(.1);
    root.traverse(part => {
      if (!part.isMesh) return;
      expect([...part.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
      expect([...part.geometry.attributes.uv.array].every(v => v >= 0 && v <= 1)).toBe(true);
    });
  }
  const region = { x: 8, z: 8 };
  const characters = Object.create(Characters.prototype); characters.people = [{ region }];
  expect(characters.nearest({x:8, y:29, z:12})).toBe(region);
  expect(characters.nearest({x:8, y:29, z:14})).toBeUndefined();
});
