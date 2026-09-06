// Ambient movement remains deterministic across peers without changing gameplay state.
export const GRAZING_LANES = [[-13, -1], [1, -13]];
export const ANIMAL_ORBIT_RADIUS = 2;

export function animalMotion(seconds, phase) {
  const clock = seconds + phase * 7;
  const cycle = Math.floor(clock / 45), t = clock - cycle * 45;
  const travel = t < 2 ? t * t / 4 : t < 31 ? t - 1 : t < 33 ? 31 - (33 - t) ** 2 / 4 : 31;
  const moving = Math.max(0, Math.min(1, t / 2, (33 - t) / 2));
  const distanceTime = cycle * 31 + travel;
  return {
    angle: distanceTime * 0.12 + phase,
    stride: distanceTime * 2.5,
    moving,
    resting: 1 - moving,
  };
}
