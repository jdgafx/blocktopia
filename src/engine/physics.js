const GRAVITY      = -28;
const JUMP_VEL     =  9;
const MOVE_SPEED   =  5;
const PLAYER_W     =  0.6;
const PLAYER_H     =  1.8;
const TERMINAL_VEL = -40;

export class Physics {
  constructor(world) {
    this._world = world;
    this._vy = 0;
    this.onGround = false;
  }

  update(pos, moveDir, jump, dt) {
    if (jump && this.onGround) {
      this._vy = JUMP_VEL;
      this.onGround = false;
    }

    this._vy = Math.max(this._vy + GRAVITY * dt, TERMINAL_VEL);

    const vx = moveDir.x * MOVE_SPEED;
    const vz = moveDir.z * MOVE_SPEED;

    pos.x += vx * dt;
    this._resolveX(pos);

    pos.y += this._vy * dt;
    this._resolveY(pos);

    pos.z += vz * dt;
    this._resolveZ(pos);
  }

  _aabbMin(pos) {
    return { x: pos.x - PLAYER_W / 2, y: pos.y,            z: pos.z - PLAYER_W / 2 };
  }
  _aabbMax(pos) {
    return { x: pos.x + PLAYER_W / 2, y: pos.y + PLAYER_H, z: pos.z + PLAYER_W / 2 };
  }

  _boxes(x, y, z, min, max) {
    if (this._world.getCollisionBoxes) return this._world.getCollisionBoxes(x, y, z, min, max);
    return this._world.isSolid(x, y, z) ? [{ min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } }] : [];
  }

  _resolveX(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          for (const box of this._boxes(bx, by, bz, mn, mx)) {
            if (box.roof && pos.y >= box.max.y - .4) continue;
            if (pos.x > (box.min.x + box.max.x) / 2) pos.x = box.max.x + PLAYER_W / 2;
            else pos.x = box.min.x - PLAYER_W / 2;
          }
        }
      }
    }
  }

  _resolveY(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    const falling = this._vy < 0;
    let boundary = falling ? -Infinity : Infinity;
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          for (const box of this._boxes(bx, by, bz, mn, mx))
            boundary = falling ? Math.max(boundary, box.max.y) : Math.min(boundary, box.min.y - PLAYER_H);
        }
      }
    }
    const collided = Number.isFinite(boundary);
    if (collided) {
      pos.y = boundary;
      this._vy = 0;
    }
    this.onGround = falling && collided;
  }

  _resolveZ(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          for (const box of this._boxes(bx, by, bz, mn, mx)) {
            if (box.roof && pos.y >= box.max.y - .4) continue;
            if (pos.z > (box.min.z + box.max.z) / 2) pos.z = box.max.z + PLAYER_W / 2;
            else pos.z = box.min.z - PLAYER_W / 2;
          }
        }
      }
    }
  }
}
