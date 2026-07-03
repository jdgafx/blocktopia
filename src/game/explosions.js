import * as THREE from 'three';
import { BLOCKS } from '../constants/blocks.js';

const FUSE_MS = 2500;
const BLAST_RADIUS = 3.5;
const DINO_BLAST_RADIUS = 7;

// Watches placed TNT, runs the fuse, blows a crater, pops nearby dinos.
// applyBlock(x,y,z,id) must update world + remesh + network-sync.
export function createExplosions({ world, scene, npcs, applyBlock }) {
  const pending = new Set();

  function boom(x, y, z) {
    const key = `${x},${y},${z}`;
    pending.delete(key);
    if (world.getBlock(x, y, z) !== BLOCKS.TNT) return; // already gone

    applyBlock(x, y, z, BLOCKS.AIR);
    const chain = [];
    const r = Math.ceil(BLAST_RADIUS);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > BLAST_RADIUS * BLAST_RADIUS) continue;
          const bx = x + dx, by = y + dy, bz = z + dz;
          const id = world.getBlock(bx, by, bz);
          if (id === BLOCKS.AIR || id === BLOCKS.BEDROCK) continue;
          if (id === BLOCKS.TNT) { chain.push([bx, by, bz]); continue; }
          applyBlock(bx, by, bz, BLOCKS.AIR);
        }
      }
    }
    flash(x + 0.5, y + 0.5, z + 0.5);

    // pop dinos caught in the blast — cartoon poof, they respawn
    for (const npc of npcs) {
      if (!npc.def.dino || npc.popped) continue;
      const d = npc.position.distanceTo(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
      if (d <= DINO_BLAST_RADIUS) popDino(npc);
    }

    // chain reaction, slightly staggered for drama
    chain.forEach(([bx, by, bz], i) => setTimeout(() => boom(bx, by, bz), 150 + i * 100));
  }

  function flash(x, y, z) {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.95 }),
    );
    ball.position.set(x, y, z);
    scene.add(ball);
    const t0 = performance.now();
    (function grow() {
      const t = (performance.now() - t0) / 450;
      if (t >= 1) { scene.remove(ball); ball.geometry.dispose(); return; }
      ball.scale.setScalar(1 + t * BLAST_RADIUS);
      ball.material.opacity = 0.95 * (1 - t);
      requestAnimationFrame(grow);
    })();
  }

  function popDino(npc) {
    npc.popped = true;
    flash(npc.position.x, npc.position.y + 1, npc.position.z);
    npc.group.visible = false;
    const home = npc.position.clone();
    setTimeout(() => {
      npc.position.copy(home);
      npc.group.visible = false; // re-show next frame via update loop position copy
      npc.group.visible = true;
      npc.popped = false;
    }, 10000);
  }

  return {
    // call when any TNT lands in the world (local place or remote sync)
    onBlockPlaced(x, y, z, id) {
      if (id !== BLOCKS.TNT) return;
      const key = `${x},${y},${z}`;
      if (pending.has(key)) return;
      pending.add(key);
      setTimeout(() => boom(x, y, z), FUSE_MS);
    },
    popDino,
  };
}
