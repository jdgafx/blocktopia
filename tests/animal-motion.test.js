import { expect, it } from 'vitest';
import { animalMotion, GRAZING_LANES, ANIMAL_ORBIT_RADIUS } from '../src/game/animal-motion.js';

it('walks, eases into a rest and resumes without position or gait jumps', () => {
  expect(animalMotion(10, 0).moving).toBe(1);
  const rest = animalMotion(35, 0);
  expect(rest.moving).toBe(0);
  expect(animalMotion(44, 0).angle).toBe(rest.angle);
  expect(animalMotion(44, 0).stride).toBe(rest.stride);
  for (const boundary of [2, 31, 33, 45, 90]) {
    const before = animalMotion(boundary - 0.0001, 0);
    const after = animalMotion(boundary + 0.0001, 0);
    expect(Math.abs(after.angle - before.angle)).toBeLessThan(0.00003);
    expect(Math.abs(after.moving - before.moving)).toBeLessThan(0.0002);
  }
  expect(animalMotion(10, Math.PI).angle).not.toBe(animalMotion(10, 0).angle);
});

it('keeps the two grazing envelopes apart and inside the level settlement terrain', () => {
  const bodyRadius = 4.3;
  for (const [x, z] of GRAZING_LANES) {
    expect(Math.hypot(x, z) + ANIMAL_ORBIT_RADIUS + bodyRadius).toBeLessThan(20);
  }
  const [a, b] = GRAZING_LANES;
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(2 * (ANIMAL_ORBIT_RADIUS + bodyRadius));
});
