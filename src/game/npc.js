import * as THREE from 'three';
import { Physics } from '../engine/physics.js';
import { BLOCKS } from '../constants/blocks.js';

// Blocky wandering NPCs with per-character storylines. Each approach by the
// player advances that NPC's story one line; lines double as gameplay hints.
const NPC_DEFS = [
  {
    name: 'Mira the Builder',
    skin: { shirt: '#c0392b', pants: '#5d4037', skinTone: '#e8b88a', hair: '#3e2723' },
    story: [
      "Oh! A new face in Blocktopia. I'm Mira — I build things. Or I did, before the storm took my house.",
      "See those trees? Hold LEFT CLICK on a trunk to chop wood. That's how every builder starts.",
      "Scroll your mouse wheel to pick Planks in the hotbar, then RIGHT CLICK the ground to place them.",
      "Four walls and a roof, that's all a home is. Build one before nightfall... well, if we had nights.",
      "You built something? I knew it. This place feels a little less empty already.",
    ],
  },
  {
    name: 'Old Pete the Miner',
    skin: { shirt: '#455a64', pants: '#263238', skinTone: '#d7a077', hair: '#9e9e9e' },
    story: [
      "Eh? Who goes there... a wanderer! Old Pete's the name. Fifty years I've dug these hills.",
      "There's COAL in the stone below us, black speckles — dig down and you'll spot it.",
      "And deeper still, iron — tan flecks in the rock. Worth more than all my teeth.",
      "Careful digging straight down, greenhorn. Bedrock's the only thing that'll stop your fall.",
      "You smell like coal dust now. Ha! You're one of us. The deep places remember us, friend.",
    ],
  },
  {
    name: 'Scout Lily',
    skin: { shirt: '#2e7d32', pants: '#4e342e', skinTone: '#f0c8a0', hair: '#e65100' },
    story: [
      "Shh — you'll scare the... oh, there's nothing to scare yet. I'm Lily, I map the wilds.",
      "Past those hills there's water — a whole sea at the low lands. Sand beaches too.",
      "Press SPACE to jump ledges. Two blocks is your limit, so plan your climbs.",
      "If you ever fall off the world's edge, don't panic — you wake up right back at the spawn meadow.",
      "The map's never finished. That's the best part. Go see what's past the fog for me, will you?",
    ],
  },
];

// spread across the land: [dx, dz] from spawn. Stories may contain {SEA},
// replaced at init with the real computed direction to water.
const FAR_DEFS = [
  {
    name: 'Sage Willow', at: [0, 22],
    skin: { shirt: '#7b1fa2', pants: '#4a148c', skinTone: '#e0ac7e', hair: '#eeeeee' },
    story: [
      'Welcome, young one. I am Willow. I remember when this world was only fog.',
      'Five friends live near the meadow where you woke — and more of us live far beyond it.',
      'The land goes on and on. Walk any direction and new ground grows under your feet.',
      'If you ever tumble off the world, the meadow calls you back. You cannot truly be lost.',
      'Build something beautiful. That is how this world remembers you.',
    ],
  },
  {
    name: 'Captain Marina', at: null, // placed at the real sea; fallback [40, 40]
    skin: { shirt: '#01579b', pants: '#263238', skinTone: '#d7a077', hair: '#212121' },
    story: [
      "Ahoy! Captain Marina. You found the sea — most landlubbers never make it this far.",
      'Water can\'t hurt you here, but you can\'t swim up it either. Build a bridge of planks!',
      'Sand marks every shore. Follow a beach and it will lead you to open water.',
      'Glass looks grand over water. Build a sea window and watch the blue through it.',
      'The horizon never ends, sailor. Neither should you.',
    ],
  },
  {
    name: 'Goldie the Prospector', at: [34, -28],
    skin: { shirt: '#f9a825', pants: '#5d4037', skinTone: '#e8b88a', hair: '#fdd835' },
    story: [
      "Well howdy! Goldie's the name, treasure's the game.",
      'Watch the middle number top-left — that\'s how deep you are. Coal shows below 24.',
      'Iron hides below 16, gold below 11 — and DIAMONDS below 7, right near the bedrock.',
      'Dig a staircase down, never straight down. First rule of prospecting!',
      'Strike diamond and you\'re rich, kid. Well — rich in bragging rights. Best kind.',
    ],
  },
  {
    name: 'Brixton the Builder-Bot', at: [-30, -20],
    skin: { shirt: '#e53935', pants: '#fbc02d', skinTone: '#b0bec5', hair: '#78909c' },
    story: [
      'BEEP. GREETINGS. I am BRIXTON, unit of building. I love bright plastic blocks.',
      'PRESS E. Your block bag holds every block — red, blue, yellow, green plastic included.',
      'TIP: number keys 1 to 9 swap your hotbar fast. Efficiency increased 340 percent.',
      'My dream: a rainbow tower to the clouds. Assist? BEEP.',
      'You build well, friend. My circuits are... proud? Yes. Proud.',
    ],
  },
  {
    name: 'Nova the Explorer', at: [-48, 36],
    skin: { shirt: '#00897b', pants: '#3e2723', skinTone: '#f0c8a0', hair: '#d84315' },
    story: [
      "You walked all the way out here? You're my kind of person. I'm Nova.",
      'The fog hides the far lands — walk toward it and it keeps giving you more world.',
      'I leave plastic towers as trail markers so I can find my way home. Try it!',
      '{SEA}',
      'Every explorer needs a story. Go make yours bigger.',
    ],
  },
];

const FAR_DINO_DEFS = [
  {
    name: 'Rex the Robo-Dino', dino: true, scale: 1.3, hide: '#78909c', belly: '#ef5350', at: [52, 18],
    story: [
      'CLANK. RAWR.EXE running. I am REX. Part dinosaur. Part machine. All friend.',
      'Blaze and Cinder are my cousins. The fire? It runs in the family. Even for robots.',
      'My scanners see ore through stone. Sadly my warranty forbids telling you where. Dig!',
      'CLANK. Return anytime. My fire keeps the far hills warm.',
    ],
  },
];

const DINO_DEFS = [
  {
    name: 'Blaze the T-Rex', dino: true, scale: 1.6, hide: '#6d8f3e', belly: '#c9d69b',
    story: [
      'RRRAAAWR!! ...oh. Sorry. I do that. I\'m Blaze. Yes, I\'m on fire. No, it doesn\'t hurt.',
      'The fire? Born with it. Makes campfires easy and hugs complicated.',
      'I guard the meadow. Nothing scary gets past a burning T-Rex, kid.',
      'RAWR means "have fun out there" in dinosaur. Mostly.',
    ],
  },
  {
    name: 'Cinder the Raptor', dino: true, scale: 1.0, hide: '#8f5e3e', belly: '#e0c9a0',
    story: [
      'Skree! Fast, aren\'t you? Not as fast as me. I\'m Cinder.',
      'I once outran the fog at the edge of the world. True story. Blaze saw it.',
      'If you dig up something shiny, show Old Pete. He cries happy tears at iron.',
      'Race you to the sea someday. Losers build the winner a house!',
    ],
  },
];

const TALK_RADIUS = 4;
const WANDER_SPEED = 0.35;
const FIRE_PARTICLES = 36;

function makeSkinTexture(skin) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = skin.skinTone; ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = skin.hair;     ctx.fillRect(0, 0, 8, 2);
  ctx.fillStyle = '#fff';        ctx.fillRect(1, 3, 2, 2); ctx.fillRect(5, 3, 2, 2);
  ctx.fillStyle = '#222';        ctx.fillRect(2, 4, 1, 1); ctx.fillRect(6, 4, 1, 1);
  ctx.fillStyle = '#8d5524';     ctx.fillRect(3, 6, 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function makeNameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 256, 40);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 21);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.4, 0.38, 1);
  sprite.position.y = 2.35;
  return sprite;
}

export function buildVillager(def) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: def.skin.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: def.skin.pants });
  const head  = new THREE.MeshLambertMaterial({ map: makeSkinTexture(def.skin) });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), pants);
  legs.position.y = 0.35;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), shirt);
  body.position.y = 1.05;
  const noggin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), head);
  noggin.position.y = 1.7;
  g.add(legs, body, noggin);
  return g;
}

function buildDino(def) {
  const s = def.scale;
  const g = new THREE.Group();
  const hide  = new THREE.MeshLambertMaterial({ color: def.hide });
  const belly = new THREE.MeshLambertMaterial({ color: def.belly });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.8 * s, 0.4 * s), hide);
  legL.position.set(-0.35 * s, 0.4 * s, 0);
  const legR = legL.clone();
  legR.position.x = 0.35 * s;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.8 * s, 1.5 * s), belly);
  body.position.set(0, 1.1 * s, -0.1 * s);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.4 * s, 1.2 * s), hide);
  tail.position.set(0, 1.1 * s, -1.35 * s);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.5 * s, 0.4 * s), hide);
  neck.position.set(0, 1.7 * s, 0.55 * s);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.45 * s, 0.9 * s), hide);
  skull.position.set(0, 2.05 * s, 0.85 * s);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.15 * s, 0.8 * s), belly);
  jaw.position.set(0, 1.78 * s, 0.85 * s);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.08 * s, 0.08 * s), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
  eyeL.position.set(-0.2 * s, 2.15 * s, 1.2 * s);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.2 * s;
  g.add(legL, legR, body, tail, neck, skull, jaw, eyeL, eyeR);
  return g;
}

function makeFire(scale) {
  const positions = new Float32Array(FIRE_PARTICLES * 3);
  const colors = new Float32Array(FIRE_PARTICLES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.22 * scale, vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.userData.life = new Float32Array(FIRE_PARTICLES); // 0..1
  return points;
}

class NPC {
  constructor(def, world, scene, x, z) {
    this.def = def;
    this.world = world;
    this.storyIdx = 0;
    this.wasNear = false;

    this.group = def.dino ? buildDino(def) : buildVillager(def);
    const label = makeNameSprite(def.name);
    if (def.dino) label.position.y = (2.6 * def.scale) + 0.3;
    this.group.add(label);
    if (def.dino) {
      this.fire = makeFire(def.scale);
      this.group.add(this.fire);
    }
    scene.add(this.group);

    this.position = new THREE.Vector3(x, this._surfaceY(x, z) + 1, z);
    this._physics = new Physics(world);
    this._dir = Math.random() * Math.PI * 2;
    this._dirTimer = 0;
  }

  _updateFire(dt) {
    const s = this.def.scale;
    const pos = this.fire.geometry.attributes.position;
    const col = this.fire.geometry.attributes.color;
    const life = this.fire.userData.life;
    for (let i = 0; i < FIRE_PARTICLES; i++) {
      life[i] -= dt * (1.2 + (i % 5) * 0.25);
      if (life[i] <= 0) {
        life[i] = 1;
        // respawn along back ridge: body + tail + skull
        const t = Math.random();
        pos.array[i * 3]     = (Math.random() - 0.5) * 0.6 * s;
        pos.array[i * 3 + 1] = (1.5 + t * 0.7) * s;
        pos.array[i * 3 + 2] = (0.9 - t * 2.2) * s;
      }
      pos.array[i * 3 + 1] += dt * 1.6 * s; // flames rise
      const l = life[i];
      col.array[i * 3]     = 1.0;           // r
      col.array[i * 3 + 1] = 0.25 + l * 0.6; // g: yellow -> red as it dies
      col.array[i * 3 + 2] = l * 0.15;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  _surfaceY(x, z) {
    for (let y = 62; y >= 1; y--) {
      if (this.world.isSolid(Math.floor(x), y, Math.floor(z))) return y;
    }
    return 30;
  }

  update(dt, playerPos) {
    if (this.fire) this._updateFire(dt);
    // wander: amble in a direction, re-roll every few seconds, jump at walls
    this._dirTimer -= dt;
    if (this._dirTimer <= 0) {
      this._dir = Math.random() * Math.PI * 2;
      this._dirTimer = 3 + Math.random() * 5;
    }
    const near = this.position.distanceTo(playerPos) < TALK_RADIUS;
    let move = { x: 0, z: 0 };
    if (!near) {
      move = { x: Math.sin(this._dir) * WANDER_SPEED, z: Math.cos(this._dir) * WANDER_SPEED };
    }
    const ahead = {
      x: Math.floor(this.position.x + move.x * 1.2),
      y: Math.floor(this.position.y),
      z: Math.floor(this.position.z + move.z * 1.2),
    };
    const blocked = this.world.isSolid(ahead.x, ahead.y, ahead.z);
    this._physics.update(this.position, move, blocked, dt);

    this.group.position.copy(this.position);
    if (near) {
      // face the player
      this.group.rotation.y = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
    } else if (move.x || move.z) {
      this.group.rotation.y = Math.atan2(move.x, move.z);
    }

    // dialog: advance one story line per fresh approach
    if (near && !this.wasNear) {
      const line = this.def.story[this.storyIdx];
      this.storyIdx = Math.min(this.storyIdx + 1, this.def.story.length - 1);
      this.wasNear = true;
      return { name: this.def.name, line };
    }
    if (!near) this.wasNear = false;
    return null;
  }
}

const DIR_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// compass name for a world-space offset (-z is north)
export function dirName(dx, dz) {
  const a = Math.atan2(dx, -dz); // 0 = north, clockwise
  return DIR_NAMES[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

// ring-scan outward for the nearest sea-level water column
export function findSea(world, spawnX, spawnZ) {
  for (let r = 8; r <= 120; r += 4) {
    for (let a = 0; a < 24; a++) {
      const x = spawnX + Math.round(Math.cos((a / 24) * 2 * Math.PI) * r);
      const z = spawnZ + Math.round(Math.sin((a / 24) * 2 * Math.PI) * r);
      if (world.getBlock(x, 21, z) === BLOCKS.WATER && world.getBlock(x, 22, z) === BLOCKS.AIR) {
        return { x, z, dist: r, dir: dirName(x - spawnX, z - spawnZ) };
      }
    }
  }
  return null;
}

export function initNPCs(world, scene, spawnX, spawnZ) {
  const sea = findSea(world, spawnX, spawnZ);
  const seaText = sea
    ? `The sea is about ${sea.dist} blocks ${sea.dir} of the spawn meadow — follow the sand`
    : 'There is a sea somewhere past the low lands — sand means water is close';

  const fill = (def) => ({
    ...def,
    story: def.story.map(line => line.replace('{SEA}', seaText + '.')),
  });

  // meadow crew near spawn
  const spots = [[6, 3], [-5, 6], [3, -7]];
  const npcs = NPC_DEFS.map((def, i) => new NPC(fill(def), world, scene, spawnX + spots[i][0], spawnZ + spots[i][1]));
  const dinoSpots = [[12, -4], [-10, -9]];
  DINO_DEFS.forEach((def, i) => npcs.push(new NPC(fill(def), world, scene, spawnX + dinoSpots[i][0], spawnZ + dinoSpots[i][1])));

  // characters spread across the land
  for (const def of FAR_DEFS) {
    let [dx, dz] = def.at ?? [40, 40];
    if (def.name === 'Captain Marina' && sea) { dx = sea.x - spawnX; dz = sea.z - spawnZ; }
    npcs.push(new NPC(fill(def), world, scene, spawnX + dx, spawnZ + dz));
  }
  for (const def of FAR_DINO_DEFS) {
    npcs.push(new NPC(fill(def), world, scene, spawnX + def.at[0], spawnZ + def.at[1]));
  }
  return { npcs, seaText };
}

export function updateNPCs(npcs, dt, playerPos) {
  const box = document.getElementById('npc-dialog');
  for (const npc of npcs) {
    const spoke = npc.update(dt, playerPos);
    if (spoke && box) {
      document.dispatchEvent(new CustomEvent('quest', { detail: 'talk:' + spoke.name }));
      box.innerHTML = `<b>${spoke.name}</b><br>${spoke.line}`;
      box.style.display = 'block';
      clearTimeout(box._hideTimer);
      box._hideTimer = setTimeout(() => { box.style.display = 'none'; }, 9000);
    }
  }
}
