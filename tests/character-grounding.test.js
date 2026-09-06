import { expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { groundFeet, footGroundHeight } from '../src/game/character-grounding.js';
import { BLOCKS } from '../src/constants/blocks.js';

it('grounds each rotated foot on edited voxel heights, ignores water and preserves horizontal story anchors', () => {
  const world = { getBlock: (x, y, z) => y <= (z < 0 ? 28 : 29) ? BLOCKS.GRASS : BLOCKS.WATER };
  const root = new Group(); root.position.set(8, 29, 8); root.rotation.y = Math.PI / 2;
  const feet = [-.3, .3].map(x => {
    const joint = new Group(); joint.position.set(x, .7, 0); root.add(joint);
    return { joint, restY: .7, point: new Vector3(0, -.7, 0) };
  });
  root.position.z = 0;
  for (let frame = 0; frame < 120; frame++) groundFeet(root, feet, world, 1 / 60);
  const positions = feet.map(foot => foot.joint.localToWorld(foot.point.clone()));
  expect(positions[0].y).toBeCloseTo(30, 2);
  expect(positions[1].y).toBeCloseTo(29.005, 2);
  expect(root.position.toArray()).toEqual([8, 29, 0]);
  expect(footGroundHeight({getBlock: () => BLOCKS.AIR}, 0, 29, 0)).toBeNull();
});

it('solves knee and ankle angles independently on a one-block step while keeping boot soles level', async () => {
  const { groundBiped } = await import('../src/game/character-grounding.js');
  const world = { getBlock: (x, y) => y <= (x < 0 ? 28 : 29) ? BLOCKS.STONE : BLOCKS.AIR };
  const root = new Group(); root.position.y = 29;
  const feet = [-.18, .18].map(x => {
    const joint = new Group(), knee = new Group(), ankle = new Group();
    joint.position.set(x, .685, 0); knee.position.y = -.31; ankle.position.y = -.2;
    root.add(joint); joint.add(knee); knee.add(ankle);
    return {joint,knee,ankle,point:new Vector3(0,-.17,.07)};
  });
  for (let frame = 0; frame < 120; frame++) groundBiped(root, feet, world, 1 / 60);
  for (const [index, foot] of feet.entries()) {
    const sole = foot.ankle.localToWorld(foot.point.clone());
    expect(sole.y).toBeCloseTo(29.005 + index, 3);
    expect(sole.z).toBeCloseTo(.07, 3);
    expect(foot.joint.rotation.x + foot.knee.rotation.x + foot.ankle.rotation.x).toBeCloseTo(0, 8);
  }
  expect(feet[1].knee.rotation.x).toBeGreaterThan(.1);
  expect(root.position.toArray()).toEqual([0,29,0]);
});
