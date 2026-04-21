import { BLOCK_DEFS, BLOCKS } from '../constants/blocks.js';

/**
 * DDA voxel raycast. Returns { x, y, z, face } of first solid block hit,
 * or null if nothing hit within maxDist.
 * face is the normal of the hit face as [dx,dy,dz] pointing away from the block.
 */
export function raycast(world, origin, direction, maxDist = 5) {
  let { x, y, z } = origin;
  const { x: dx, y: dy, z: dz } = direction;

  let bx = Math.floor(x);
  let by = Math.floor(y);
  let bz = Math.floor(z);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / dx) || Infinity;
  const tDeltaY = Math.abs(1 / dy) || Infinity;
  const tDeltaZ = Math.abs(1 / dz) || Infinity;

  let tMaxX = dx > 0 ? (bx + 1 - x) / dx : (x - bx) / -dx;
  let tMaxY = dy > 0 ? (by + 1 - y) / dy : (y - by) / -dy;
  let tMaxZ = dz > 0 ? (bz + 1 - z) / dz : (z - bz) / -dz;
  tMaxX = isFinite(tMaxX) ? Math.abs(tMaxX) : Infinity;
  tMaxY = isFinite(tMaxY) ? Math.abs(tMaxY) : Infinity;
  tMaxZ = isFinite(tMaxZ) ? Math.abs(tMaxZ) : Infinity;

  let face = [0, 0, 0];
  let t = 0;

  while (t < maxDist) {
    const id = world.getBlock(bx, by, bz);
    const def = BLOCK_DEFS[id];
    if (id !== BLOCKS.AIR && def && def.solid) {
      return { x: bx, y: by, z: bz, face };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      bx += stepX;
      face = [-stepX, 0, 0];
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      by += stepY;
      face = [0, -stepY, 0];
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      bz += stepZ;
      face = [0, 0, -stepZ];
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
