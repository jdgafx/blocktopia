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

  _resolveX(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (pos.x > bx + 0.5) pos.x = bx + 1 + PLAYER_W / 2;
          else                   pos.x = bx   - PLAYER_W / 2;
        }
      }
    }
  }

  _resolveY(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    let hitFloor = false;
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (this._vy < 0) { pos.y = by + 1; hitFloor = true; }
          else               { pos.y = by - PLAYER_H; }
          this._vy = 0;
        }
      }
    }
    this.onGround = hitFloor;
    if (!hitFloor && this._vy <= 0) this.onGround = false;
  }

  _resolveZ(pos) {
    const mn = this._aabbMin(pos);
    const mx = this._aabbMax(pos);
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (pos.z > bz + 0.5) pos.z = bz + 1 + PLAYER_W / 2;
          else                   pos.z = bz   - PLAYER_W / 2;
        }
      }
    }
  }
}
