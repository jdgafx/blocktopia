import { Vector3, MathUtils } from 'three';
import { BLOCK_DEFS } from '../constants/blocks.js';

const footPosition = new Vector3();
// Sample a short vertical voxel column, including edits, without raycasting every terrain triangle.
export function footGroundHeight(world, x, y, z) {
  x = Math.floor(x); z = Math.floor(z);
  for (let blockY = Math.floor(y + 1); blockY >= Math.floor(y - 2); blockY--) {
    if (BLOCK_DEFS[world.getBlock(x, blockY, z)]?.solid) return blockY + 1;
  }
  return null;
}

export function groundFeet(root, feet, world, dt) {
  root.updateWorldMatrix(true, true);
  for (const foot of feet) {
    const { joint, restY, point } = foot;
    joint.position.y = restY;
    joint.updateWorldMatrix(true, false);
    joint.localToWorld(footPosition.copy(point));
    const height = footGroundHeight(world, footPosition.x, footPosition.y, footPosition.z);
    // ponytail: rigid voxel limbs use one vertical joint constraint; add knee bones for bending characters.
    const target = height === null ? 0 : MathUtils.clamp(height + .005 - footPosition.y, -1, 1);
    foot.offset = MathUtils.lerp(foot.offset ?? 0, target, 1 - Math.exp(-18 * dt));
    joint.position.y = restY + foot.offset;
    joint.updateMatrixWorld(true);
  }
}

// Analytic two-bone solve in the character's sagittal plane. Angles preserve the ankle's upright pose.
export function solveLeg(upper, lower, down, forward = 0) {
  const distance = MathUtils.clamp(Math.hypot(down, forward), Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
  const direction = Math.atan2(forward, down);
  const hip = -direction - Math.acos(MathUtils.clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
  const knee = Math.PI - Math.acos(MathUtils.clamp((upper * upper + lower * lower - distance * distance) / (2 * upper * lower), -1, 1));
  return { hip, knee, ankle: -hip - knee };
}

const anklePosition = new Vector3();
export function groundBiped(root, feet, world, dt) {
  for (const foot of feet) {
    const { joint, knee, ankle, point } = foot;
    joint.rotation.x = knee.rotation.x = ankle.rotation.x = 0;
    root.updateWorldMatrix(true, true);
    ankle.localToWorld(footPosition.copy(point));
    const ground = footGroundHeight(world, footPosition.x, footPosition.y, footPosition.z);
    const offset = ground === null ? 0 : ground + .005 - footPosition.y;
    foot.offset = MathUtils.lerp(foot.offset ?? 0, offset, 1 - Math.exp(-18 * dt));
    ankle.getWorldPosition(anklePosition); anklePosition.y += foot.offset;
    joint.worldToLocal(anklePosition);
    const angles = solveLeg(-knee.position.y, -ankle.position.y, -anklePosition.y, anklePosition.z);
    joint.rotation.x = angles.hip; knee.rotation.x = angles.knee; ankle.rotation.x = angles.ankle;
    joint.updateMatrixWorld(true);
  }
}
