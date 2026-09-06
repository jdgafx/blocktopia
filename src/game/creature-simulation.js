import { CREATURE_SPECIES, SPECIES_IDS } from './creature-species.js';
import { validCreatureState, validEntityId, newCreaturePlayer, MAX_CREATURES, MAX_CREATURE_RECORDS, MAX_CREATURE_PLAYERS } from './creature-state.js';
import { getRegion } from './regions.js';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = number => Math.round(number * 1000) / 1000;
function groundAt(x, z, context) {
  const bx = Math.floor(x), bz = Math.floor(z), height = context.surfaceHeight?.(bx, bz);
  if (!Number.isFinite(height) || height < 1 || height > 60) return null;
  if (!context.getBlock) return height < 21 ? null : height + 1;
  for (let y = Math.min(62, Math.floor(height) + 4); y >= Math.max(0, height - 12); y--) {
    if (context.getBlock(bx, y, bz) === 14) return null;
    if (context.isSolid?.(bx, y, bz)) return y + 1;
  }
  return null;
}
function clearAt(x, y, z, species, context) {
  if (!context.isSolid) return true;
  for (const [dx, dz] of [[0,0], [species.radius,0], [-species.radius,0], [0,species.radius], [0,-species.radius]]) {
    for (const dy of [.15, species.height * .5, species.height - .1])
      if (context.isSolid(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz))) return false;
  }
  return true;
}
function createCreature(id, speciesId, x, y, z, now) {
  const species = CREATURE_SPECIES[speciesId], boldness = round(.15 + hash(`${id}:bold`) * .7);
  const temperament = species.temperament === 'calm' && boldness > .78 ? 'bold'
    : species.temperament === 'bold' && boldness < .28 ? 'shy' : species.temperament;
  return { id, species: speciesId, x, y, z, homeX: x, homeZ: z, yaw: 0,
    health: species.health, hunger: 30 + Math.floor(hash(`${id}:hunger`) * 11), fear: 0, boldness, temperament,
    trust: {}, ownerId: null, behavior: 'wandering', command: 'follow', active: true, harvested: false, touched: false,
    lastPositiveAt: 0, lastAttackAt: 0, lastHurtAt: 0, lastSimAt: now,
    threatId: null, speed: 0, scale: 1, age: 'adult', bag: {} };
}
function encounter(seed, gx, gz, slot, context, now) {
  const id = `wild:${seed}:${gx}:${gz}:${slot}`;
  let x = gx * 40 + 7 + hash(`${id}:x`) * 26, z = gz * 40 + 7 + hash(`${id}:z`) * 26;
  const region = getRegion(x, z), nearVillage = distance({ x, z }, region);
  if (nearVillage < 23) {
    const angle = hash(`${id}:angle`) * Math.PI * 2;
    x = region.x + Math.cos(angle) * 27; z = region.z + Math.sin(angle) * 27;
  }
  x = round(x); z = round(z);
  const habitat = getRegion(x, z).id;
  const pool = SPECIES_IDS.filter(key => CREATURE_SPECIES[key].habitats.includes(habitat))
    .flatMap(key => Array(CREATURE_SPECIES[key].weight).fill(key));
  const speciesId = pool[Math.floor(hash(`${id}:species`) * pool.length)], species = CREATURE_SPECIES[speciesId];
  const y = groundAt(x, z, context), base = context.surfaceHeight?.(Math.floor(x), Math.floor(z));
  if (y === null || y > base + 2 || !clearAt(x, y, z, species, context)) return null;
  return createCreature(id, speciesId, x, y, z, now);
}
function populate(state, players, context, now) {
  const nearest = c => Math.min(...players.map(p => distance(c, p.position)));
  const ownerPresent = c => players.some(p => p.id === c.ownerId);
  for (const [id, c] of Object.entries(state.creatures)) {
    if (!c.touched && nearest(c) > 96) delete state.creatures[id];
    else c.active = false;
  }
  const nearby = Object.values(state.creatures).filter(c => !c.harvested && (nearest(c) < 80
    || (c.health > 0 && c.ownerId && ownerPresent(c) && c.command === 'follow')))
    .sort((a, b) => Number(Boolean(b.ownerId)) - Number(Boolean(a.ownerId)) || nearest(a) - nearest(b) || a.id.localeCompare(b.id));
  nearby.slice(0, MAX_CREATURES).forEach(c => { c.active = true; });
  let available = MAX_CREATURES - Math.min(MAX_CREATURES, nearby.length);
  if (!available || Object.keys(state.creatures).length >= MAX_CREATURE_RECORDS) return;
  const sectors = new Set();
  for (const player of players) {
    const gx = Math.floor(player.position.x / 40), gz = Math.floor(player.position.z / 40);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) sectors.add(`${gx + dx},${gz + dz}`);
  }
  const candidates = [];
  for (const key of sectors) {
    const [gx, gz] = key.split(',').map(Number);
    for (let slot = 0; slot < 2; slot++) {
      const id = `wild:${state.seed}:${gx}:${gz}:${slot}`;
      // Defeated/harvested IDs remain as tombstones and are never recreated.
      if (Object.prototype.hasOwnProperty.call(state.creatures, id)) continue;
      const c = encounter(state.seed, gx, gz, slot, context, now);
      if (c && nearest(c) < 72) candidates.push(c);
    }
  }
  candidates.sort((a, b) => nearest(a) - nearest(b) || a.id.localeCompare(b.id));
  for (const c of candidates) {
    if (available <= 0 || Object.keys(state.creatures).length >= MAX_CREATURE_RECORDS) break;
    state.creatures[c.id] = c; available--;
  }
}
function move(c, target, speed, elapsed, context) {
  const species = CREATURE_SPECIES[c.species], startX = c.x, startZ = c.z, remaining = distance(c, target);
  if (remaining < .15) { c.speed = 0; return; }
  const heading = Math.atan2(target.x - c.x, target.z - c.z), travel = Math.min(remaining, speed * elapsed);
  // Short collision steps avoid tunnelling through new player-built walls during reduced far updates.
  const steps = Math.max(1, Math.ceil(travel / .22));
  for (let step = 0; step < steps; step++) {
    let moved = false;
    for (const turn of [0, .7, -.7, 1.3, -1.3]) {
      const yaw = heading + turn, x = c.x + Math.sin(yaw) * travel / steps, z = c.z + Math.cos(yaw) * travel / steps;
      const y = groundAt(x, z, context);
      if (y === null || Math.abs(y - c.y) > 1.05 || !clearAt(x, y, z, species, context)) continue;
      c.x = round(x); c.y = y; c.z = round(z); c.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); moved = true; break;
    }
    if (!moved) break;
  }
  c.speed = Math.min(species.sprint, distance({ x: startX, z: startZ }, c) / Math.max(elapsed, .001));
}
function hurtCreature(target, source, now, amount) {
  target.health = Math.max(0, target.health - amount); target.fear = Math.min(100, target.fear + 25);
  target.threatId = `c:${source.id}`; target.lastHurtAt = now; target.touched = true;
  if (!target.health) { target.behavior = 'dead'; target.speed = 0; target.threatId = null; }
}
function attack(c, target, kind, state, now, context) {
  const species = CREATURE_SPECIES[c.species];
  if (context.canReach?.(c, target.position ?? target) === false) return;
  if (distance(c, target.position ?? target) > species.reach || (c.lastAttackAt && now - c.lastAttackAt < 1200)) return;
  if (kind === 'player') {
    const player = state.players[target.id];
    if (target.active === false || !player || player.health <= 0 || now < player.downedUntil) return;
    player.health = Math.max(0, player.health - species.damage); player.lastHurtAt = now; player.attackerId = c.id;
    if (!player.health) player.downedUntil = now + 8000;
  } else {
    hurtCreature(target, c, now, species.damage);
    if (!target.health) { c.hunger = Math.min(100, c.hunger + 50); c.threatId = null; c.behavior = 'resting'; }
  }
  c.lastAttackAt = now; c.touched = true;
}
function think(c, state, players, now, elapsed, context) {
  const species = CREATURE_SPECIES[c.species]; c.speed = 0;
  if (c.health <= 0) { c.behavior = 'dead'; return; }
  c.hunger = Math.max(0, c.hunger - elapsed * .07);
  const activePlayers = players.filter(p => p.active !== false && state.players[p.id]?.health > 0 && now >= state.players[p.id].downedUntil);
  const nearest = [...activePlayers].sort((a, b) => distance(c, a.position) - distance(c, b.position))[0];
  const owner = players.find(p => p.id === c.ownerId);
  let threat = c.threatId?.startsWith('p:') ? activePlayers.find(p => p.id === c.threatId.slice(2))
    : c.threatId?.startsWith('c:') ? state.creatures[c.threatId.slice(2)] : null;
  if (threat && (distance(c, threat.position ?? threat) > 30 || (threat.health !== undefined && threat.health <= 0)
    || now - c.lastHurtAt > 15000 && c.behavior !== 'hunting')) { threat = null; c.threatId = null; }
  const attacker = owner && state.players[owner.id]?.attackerId && state.creatures[state.players[owner.id].attackerId];
  if (!threat && attacker?.health > 0 && now - state.players[owner.id].lastHurtAt < 10000 && distance(c, attacker) < 24) {
    threat = attacker; c.threatId = `c:${attacker.id}`; c.behavior = 'defending';
  }
  if (threat) {
    const point = threat.position ?? threat, flee = c.temperament === 'shy' || c.health < species.health * .25 || c.fear > 85 || threat.id === c.ownerId;
    if (flee) {
      c.behavior = 'fleeing'; const dx = c.x - point.x, dz = c.z - point.z;
      move(c, { x: c.x + (dx || 1) * 3, z: c.z + dz * 3 }, species.sprint, elapsed, context);
    } else {
      c.behavior = c.behavior === 'hunting' ? 'hunting' : 'defending';
      if (distance(c, point) > species.reach * .85) move(c, point, species.sprint, elapsed, context);
      c.yaw = Math.atan2(point.x - c.x, point.z - c.z);
      attack(c, threat, threat.position ? 'player' : 'creature', state, now, context);
    }
    return;
  }
  c.fear = Math.max(0, c.fear - elapsed * 2);
  if (c.ownerId) {
    if (c.command === 'stay' || !owner) { c.behavior = 'staying'; return; }
    c.behavior = distance(c, owner.position) > 3 ? 'following' : 'resting';
    if (c.behavior === 'following') move(c, owner.position, distance(c, owner.position) > 9 ? species.sprint : species.speed, elapsed, context);
    return;
  }
  if (nearest && distance(c, nearest.position) < 6) {
    if ((c.trust[nearest.id] ?? 0) >= 20) {
      c.behavior = 'social'; c.yaw = Math.atan2(nearest.position.x - c.x, nearest.position.z - c.z); return;
    }
    if (c.temperament === 'shy') {
      c.fear = Math.min(100, c.fear + elapsed * (12 - c.boldness * 4));
      if (c.fear > 40) { c.threatId = `p:${nearest.id}`; c.lastHurtAt = now; c.behavior = 'fleeing'; return; }
    } else if (c.temperament === 'territorial' || (c.temperament === 'bold' && c.hunger < 25)) {
      c.threatId = `p:${nearest.id}`; c.lastHurtAt = now; c.behavior = 'defending'; return;
    }
    c.behavior = 'social'; c.yaw = Math.atan2(nearest.position.x - c.x, nearest.position.z - c.z); return;
  }
  if (species.prey.length && c.hunger < 45) {
    const prey = Object.values(state.creatures).filter(other => other.active && other.health > 0 && other.id !== c.id
      && species.prey.includes(other.species) && distance(c, other) < 18).sort((a, b) => distance(c, a) - distance(c, b))[0];
    if (prey) { c.threatId = `c:${prey.id}`; c.behavior = 'hunting'; return; }
  }
  const herd = Object.values(state.creatures).find(other => other.id !== c.id && other.active && other.health > 0
    && other.species === c.species && distance(c, other) > 4 && distance(c, other) < 12);
  if (herd && hash(`${c.id}:${Math.floor(now / 7000)}`) > .65) {
    c.behavior = 'social'; move(c, herd, species.speed * .7, elapsed, context); return;
  }
  const period = Math.floor(now / 9000), resting = hash(`${c.id}:${period}:rest`) < .45;
  if (resting) {
    c.behavior = species.prey.length ? 'resting' : 'grazing';
    if (c.behavior === 'grazing') c.hunger = Math.min(100, c.hunger + elapsed * .8);
  } else {
    const angle = hash(`${c.id}:${period}:walk`) * Math.PI * 2;
    c.behavior = 'wandering'; move(c, { x: c.homeX + Math.cos(angle) * 8, z: c.homeZ + Math.sin(angle) * 8 }, species.speed, elapsed, context);
  }
}

// Host-only reduced simulation; returns a new JSON state and preserves the caller-owned revision.
export function stepCreatures(state, context = {}) {
  if (!validCreatureState(state) || !Number.isSafeInteger(context.now) || context.now <= state.lastStepAt
    || !Number.isFinite(context.dt) || context.dt <= 0 || typeof context.surfaceHeight !== 'function') return state;
  const { now } = context, next = structuredClone(state), dt = Math.min(.25, context.dt);
  const players = (Array.isArray(context.players) ? context.players : []).map(p => ({ ...p, id: p.id ?? p.actorId }))
    .filter(p => validEntityId(p.id) && p.position && ['x','y','z'].every(axis => Number.isFinite(p.position[axis])
      && Math.abs(p.position[axis]) <= 1000000)).sort((a, b) => a.id.localeCompare(b.id));
  for (const p of players) {
    if (!next.players[p.id] && Object.keys(next.players).length < MAX_CREATURE_PLAYERS) next.players[p.id] = newCreaturePlayer();
    const player = next.players[p.id];
    if (!player || p.active === false || player.health <= 0) continue;
    player.hunger = Math.max(0, player.hunger - dt * .06);
    if (player.hunger === 0) {
      player.health = Math.max(0, player.health - dt * .35);
      if (!player.health) player.downedUntil = now + 8000;
    }
  }
  const knownPlayers = players.filter(p => next.players[p.id]);
  populate(next, knownPlayers, context, now);
  for (const c of Object.values(next.creatures)) {
    if (!c.active) continue;
    const near = Math.min(...knownPlayers.map(p => distance(c, p.position)));
    if (c.lastSimAt && now - c.lastSimAt < (near > 40 ? 500 : 80)) continue;
    const elapsed = c.lastSimAt ? Math.min(1, (now - c.lastSimAt) / 1000) : dt;
    c.lastSimAt = now; think(c, next, knownPlayers, now, elapsed, context);
  }
  next.lastStepAt = now;
  return next;
}
