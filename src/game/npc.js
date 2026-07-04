import * as THREE from 'three';
import { Physics } from '../engine/physics.js';
import { BLOCKS } from '../constants/blocks.js';
import { loadModels, spawnModel } from './models.js';

// Animated glTF NPCs with per-character storylines. Each approach by the
// player advances that NPC's story one line; lines double as gameplay hints.
// Models are rigged Quaternius CC0 characters; blocky avatars remain as a
// fallback if the GLBs fail to load.
const NPC_DEFS = [
  {
    name: 'Mira the Builder',
    model: 'character', height: 1.8, tint: '#ffc4b8', greet: 'Wave',
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
    model: 'character', height: 1.75, tint: '#b8c4cc', greet: 'Wave',
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
    model: 'character', height: 1.7, tint: '#c8e6c9', greet: 'Wave',
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
    model: 'character', height: 1.8, tint: '#e1bee7', greet: 'Wave',
    skin: { shirt: '#7b1fa2', pants: '#4a148c', skinTone: '#e0ac7e', hair: '#eeeeee' },
    story: [
      'Welcome, young one. I am Willow. I remember when this world was only fog.',
      'Five friends live near the meadow where you woke — and more of us live far beyond it.',
      'The dinosaurs came with the storm. Gentle souls, all of them. Blaze watches over the herd.',
      'If you ever tumble off the world, the meadow calls you back. You cannot truly be lost.',
      'Build something beautiful. That is how this world remembers you.',
    ],
  },
  {
    name: 'Captain Marina', at: null, // placed at the real sea; fallback [40, 40]
    model: 'character', height: 1.8, tint: '#b3d4f0', greet: 'Wave',
    skin: { shirt: '#01579b', pants: '#263238', skinTone: '#d7a077', hair: '#212121' },
    story: [
      "Ahoy! Captain Marina. You found the sea — most landlubbers never make it this far.",
      'Press and hold SPACE in the water to paddle. Even a Stegosaurus can swim. Probably.',
      'Sand marks every shore. Follow a beach and it will lead you to open water.',
      'Glass looks grand over water. Build a sea window and watch the blue through it.',
      'The horizon never ends, sailor. Neither should you.',
    ],
  },
  {
    name: 'Goldie the Prospector', at: [34, -28],
    model: 'character', height: 1.75, tint: '#ffe9a8', greet: 'Wave',
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
    model: 'robot', height: 2.3, greet: 'Hello',
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
    model: 'cyber', height: 1.85, greet: 'Wave',
    skin: { shirt: '#00897b', pants: '#3e2723', skinTone: '#f0c8a0', hair: '#d84315' },
    story: [
      "You walked all the way out here? You're my kind of person. I'm Nova.",
      'The fog hides the far lands — walk toward it and it keeps giving you more world.',
      'I leave plastic towers as trail markers so I can find my way home. Try it!',
      '{SEA}',
      'Every explorer needs a story. Go make yours bigger.',
    ],
  },
  {
    name: 'Sir Bricks-a-Lot', at: [14, 18],
    model: 'knight', height: 1.9,
    skin: { shirt: '#9e9e9e', pants: '#616161', skinTone: '#e8b88a', hair: '#3e2723' },
    story: [
      'Halt! ...at ease, traveler. I am Sir Bricks-a-Lot, sworn protector of the dinosaur herd.',
      'Six noble dinosaurs roam these lands. Blaze the T-Rex leads them — speak with him first.',
      'Topsy grazes east of the meadow. Spike naps to the west. Both quite friendly. Mostly.',
      'Melody sings in the south-east hills, and mighty Titan wanders the south-west. Seek them!',
      'A true knight befriends every dinosaur. You have the makings of one. Onward!',
    ],
  },
];

// The herd: 6 dinosaurs woven into the main quest line (q-dinos). Blaze
// hands out the quest; meeting all six reunites the herd. Fire dinos carry
// particle flames; every dino greets with a happy jump.
const DINO_DEFS = [
  {
    name: 'Blaze the T-Rex', dino: true, herd: true, fire: true,
    model: 'trex', height: 3.4, greet: 'Jump',
    hide: '#6d8f3e', belly: '#c9d69b',
    story: [
      'RRRAAAWR!! ...oh. Sorry. I do that. I\'m Blaze. Yes, I\'m on fire. No, it doesn\'t hurt.',
      'The storm that took Mira\'s house scattered my herd too. Five dino friends, spread across the land.',
      'Cinder stayed near me. But Topsy, Spike, Melody and Titan wandered far. Find them all for me?',
      'Sir Bricks-a-Lot by the east trees knows where everyone roams. Tell them Blaze says RAWR.',
      'When you\'ve met the whole herd, my fire will burn extra happy. RAWR means thank you. Mostly.',
    ],
  },
  {
    name: 'Cinder the Raptor', dino: true, herd: true, fire: true,
    model: 'raptor', height: 1.6, greet: 'Jump',
    hide: '#8f5e3e', belly: '#e0c9a0',
    story: [
      'Skree! Fast, aren\'t you? Not as fast as me. I\'m Cinder.',
      'I once outran the fog at the edge of the world. True story. Blaze saw it.',
      'Looking for the herd? Topsy\'s east, Spike\'s west, Melody\'s south-east, Titan\'s south-west.',
      'Race you to the sea someday. Losers build the winner a house!',
    ],
  },
  {
    name: 'Topsy the Triceratops', dino: true, herd: true, at: [20, 12],
    model: 'trice', height: 2.2, greet: 'Jump',
    hide: '#7a8a5a', belly: '#d6cf9b',
    story: [
      'Hmph. Another two-legs. ...oh, you\'re the one Blaze mentioned? Fine. I\'m Topsy.',
      'Three horns, zero patience. But the herd says I have to be nice, so: hello.',
      'Stone breaks slower than dirt, you know. Hold LEFT CLICK and be patient, like me. Ha!',
      'The storm blew me clear over the meadow. Rude. But the grass here is better anyway.',
      'Tell Blaze I\'m fine. And that his fire still shows from here. Show-off.',
    ],
  },
  {
    name: 'Spike the Stegosaurus', dino: true, herd: true, at: [-18, 16],
    model: 'stego', height: 2.3, greet: 'Jump',
    hide: '#5a7a6a', belly: '#c9d6b0',
    story: [
      'Zzz... huh? Oh. A visitor. I\'m Spike. I was napping. I\'m always napping.',
      'My back plates? They catch the sun. Solar-powered napping. Very advanced.',
      'If you place TNT, waddle away fast — the boom knocks blocks AND naps flying.',
      'The herd? Tell Blaze I\'m awake. That\'ll make him laugh. I\'m never awake.',
      'Zzz... oh, still here? Build me a shady wall sometime, friend. Best nap upgrade there is.',
    ],
  },
  {
    name: 'Melody the Parasaurolophus', dino: true, herd: true, at: [26, -20],
    model: 'para', height: 2.5, greet: 'Jump',
    hide: '#8a6a9a', belly: '#e0d0e8',
    story: [
      'Ooooo-woooo! That\'s my hello song. I\'m Melody! My crest is a built-in trumpet.',
      'I sing to the sea every morning. {SEA}',
      'Blaze sent you? Then the herd song is nearly whole again! Ooooo-woooo!',
      'Sing with me: press SPACE twice, real quick — and you FLY. Flying is just singing with your feet.',
      'When the whole herd is found, listen close. The wind will carry all six of our songs.',
    ],
  },
  {
    name: 'Titan the Apatosaurus', dino: true, herd: true, at: [-26, -30],
    model: 'apato', height: 4.6, greet: 'Jump',
    hide: '#6a7a8a', belly: '#c0ccd6',
    story: [
      '...down here, little one. No, HERE. Hello. I am Titan. I am very tall. You are very not.',
      'I eat leaves from the treetops. You can break leaves too — sometimes saplings hide inside.',
      'The storm could not move me. I AM the place where I stand. The herd knows to find me here.',
      'Blaze worries too much. Tell him the mountain says hello. The mountain is me. That\'s the joke.',
      'Climb something tall and look far, small friend. The world is bigger than any storm.',
    ],
  },
];

const FAR_DINO_DEFS = [
  {
    name: 'Rex the Robo-Dino', dino: true, fire: true, at: [52, 18],
    model: 'raptor', height: 1.7, tint: '#9fb4c8', greet: 'Jump',
    hide: '#78909c', belly: '#ef5350',
    story: [
      'CLANK. RAWR.EXE running. I am REX. Part dinosaur. Part machine. All friend.',
      'Blaze and Cinder are my cousins. The fire? It runs in the family. Even for robots.',
      'My scanners see ore through stone. Sadly my warranty forbids telling you where. Dig!',
      'CLANK. Return anytime. My fire keeps the far hills warm.',
    ],
  },
];

// names that count toward the "reunite the herd" quest
export const HERD_NAMES = DINO_DEFS.filter(d => d.herd).map(d => d.name);

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

export function makeNameSprite(name, y = 2.35) {
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
  sprite.position.y = y;
  return sprite;
}

// blocky fallback avatar (also used for remote players until models load)
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

function buildDinoFallback(def) {
  const s = (def.height || 2) / 2.1;
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
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.45 * s, 0.9 * s), hide);
  skull.position.set(0, 2.05 * s, 0.85 * s);
  g.add(legL, legR, body, tail, skull);
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
    // fire/label vertical scale in old blocky units (height ~= 2.1 * scale)
    this.scale = (def.height || 1.8) / 2.1;

    this.group = new THREE.Group();
    const labelY = (def.height || 1.8) + 0.5;
    this.group.add(makeNameSprite(def.name, labelY));
    if (def.fire) {
      this.fire = makeFire(this.scale);
      this.group.add(this.fire);
    }
    scene.add(this.group);

    this.position = new THREE.Vector3(x, this._surfaceY(x, z) + 1, z);
    this._physics = new Physics(world);
    this._dir = Math.random() * Math.PI * 2;
    this._dirTimer = 0;
  }

  // called by initNPCs once the model library is ready (or failed)
  attachModel(ok) {
    if (this.body) return;
    const m = ok && spawnModel(this.def.model, {
      height: this.def.height, tint: this.def.tint,
    });
    if (m) {
      this._anim = m;
      this.body = m.group;
    } else {
      this.body = this.def.dino ? buildDinoFallback(this.def) : buildVillager(this.def);
    }
    this.group.add(this.body);
  }

  _updateFire(dt) {
    const s = this.scale;
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

    if (this._anim) {
      this._anim.play(near || (!move.x && !move.z) ? 'Idle' : 'Walk');
      this._anim.update(dt);
    }

    // dialog: advance one story line per fresh approach
    if (near && !this.wasNear) {
      const line = this.def.story[this.storyIdx];
      this.storyIdx = Math.min(this.storyIdx + 1, this.def.story.length - 1);
      this.wasNear = true;
      if (this._anim && this.def.greet) this._anim.playOnce(this.def.greet);
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
  const dinoSpots = { 'Blaze the T-Rex': [12, -4], 'Cinder the Raptor': [-10, -9] };
  for (const def of DINO_DEFS) {
    const [dx, dz] = def.at ?? dinoSpots[def.name];
    npcs.push(new NPC(fill(def), world, scene, spawnX + dx, spawnZ + dz));
  }

  // characters spread across the land
  for (const def of FAR_DEFS) {
    let [dx, dz] = def.at ?? [40, 40];
    if (def.name === 'Captain Marina' && sea) { dx = sea.x - spawnX; dz = sea.z - spawnZ; }
    npcs.push(new NPC(fill(def), world, scene, spawnX + dx, spawnZ + dz));
  }
  for (const def of FAR_DINO_DEFS) {
    npcs.push(new NPC(fill(def), world, scene, spawnX + def.at[0], spawnZ + def.at[1]));
  }

  loadModels().then(ok => npcs.forEach(n => n.attachModel(ok)));
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
