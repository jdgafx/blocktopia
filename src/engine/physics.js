const GRAVITY      = -28;
const JUMP_VEL     =  9;
const MOVE_SPEED   =  5;
const PLAYER_W     =  0.6;
const PLAYER_H     =  1.8;
const TERMINAL_VEL = -40;

// swimming: buoyant, effortless — paddle up with SPACE, drift down gently
const WATER_ID        = 14;
const SWIM_UP_VEL     = 4.5;
const SWIM_UP_ACCEL   = 30;
const WATER_SINK_VEL  = -1.6;
const WATER_SINK_ACCEL = -10;
const SWIM_EXIT_BOOST = 7; // hop out of the water onto land
const FLY_VEL         = 8; // creative-flight vertical speed

export class Physics {
  constructor(world) {
    this._world = world;
    this._vy = 0;
    this.onGround = false;
    this.inWater = false;
  }

  _blockAt(pos, dy) {
    return this._world.getBlock(Math.floor(pos.x), Math.floor(pos.y + dy), Math.floor(pos.z));
  }

  update(pos, moveDir, jump, dt, opts = {}) {
    const wasInWater = this.inWater;
    // in water when waist or head is submerged
    this.inWater = this._blockAt(pos, 0.5) === WATER_ID || this._blockAt(pos, 1.4) === WATER_ID;

    if (opts.flying) {
      // creative flight: no gravity, SPACE up, SHIFT down, snappy stop
      this._vy = jump ? FLY_VEL : opts.down ? -FLY_VEL : 0;
      this.onGround = false;
    } else if (this.inWater) {
      if (jump) this._vy = Math.min(this._vy + SWIM_UP_ACCEL * dt, SWIM_UP_VEL);
      else      this._vy = Math.max(this._vy + WATER_SINK_ACCEL * dt, WATER_SINK_VEL);
      this.onGround = false;
    } else {
      if (jump && this.onGround) {
        this._vy = JUMP_VEL;
        this.onGround = false;
      } else if (jump && wasInWater && this._vy > 0) {
        this._vy = SWIM_EXIT_BOOST; // clear the shore lip
      }
      this._vy = Math.max(this._vy + GRAVITY * dt, TERMINAL_VEL);
    }

    const speed = opts.flying ? MOVE_SPEED * 1.8 : MOVE_SPEED;
    const vx = moveDir.x * speed;
    const vz = moveDir.z * speed;

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
    // Decide floor-vs-ceiling ONCE from travel direction. Zeroing _vy inside
    // the loop made the 2nd solid block of the same floor row take the
    // ceiling branch and teleport the player down -> sinking through terrain.
    const falling = this._vy < 0;
    let hit = false;
    for (let bx = Math.floor(mn.x); bx <= Math.floor(mx.x - 1e-6); bx++) {
      for (let by = Math.floor(mn.y); by <= Math.floor(mx.y - 1e-6); by++) {
        for (let bz = Math.floor(mn.z); bz <= Math.floor(mx.z - 1e-6); bz++) {
          if (!this._world.isSolid(bx, by, bz)) continue;
          if (falling) pos.y = Math.max(pos.y, by + 1);        // topmost floor wins
          else         pos.y = Math.min(pos.y, by - PLAYER_H); // lowest ceiling wins
          hit = true;
        }
      }
    }
    if (hit) this._vy = 0;
    this.onGround = falling && hit;
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
