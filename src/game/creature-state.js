import { CREATURE_SPECIES, CREATURE_BEHAVIORS } from './creature-species.js';
import { SUPPLY_IDS, PROVISIONS as P } from './items.js';
import { getRegion } from './regions.js';

export const MAX_CREATURES = 24;
export const MAX_CREATURE_RECORDS = 256;
export const MAX_CREATURE_PLAYERS = 64;
export const PLAYER_BAG_CAPACITY = 40;
export const CREATURE_ACTIONS = Object.freeze(['fight', 'harvest', 'feed', 'care', 'follow', 'stay', 'release', 'deposit', 'withdraw', 'load', 'unload', 'eat', 'forage', 'recover']);
const MAX_STACK = 1000000;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const validEntityId = id => typeof id === 'string' && id.length <= 128 && /^[a-zA-Z0-9_-][a-zA-Z0-9:_-]*$/.test(id)
  && !['__proto__', 'prototype', 'constructor'].includes(id);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const timestamp = n => Number.isSafeInteger(n) && n >= 0;
const keys = (object, allowed) => plain(object) && Object.keys(object).every(key => allowed.includes(key));
export const bagCount = bag => Object.values(bag).reduce((sum, n) => sum + n, 0);
export function validInventory(bag, capacity = MAX_STACK * SUPPLY_IDS.length) {
  return plain(bag) && Object.keys(bag).length <= SUPPLY_IDS.length
    && Object.entries(bag).every(([id, count]) => String(Number(id)) === id && SUPPLY_IDS.includes(Number(id))
      && Number.isSafeInteger(count) && count >= 0 && count <= MAX_STACK) && bagCount(bag) <= capacity;
}
export function initialCreatureState(seed) {
  return { version: 1, seed: Number(seed) >>> 0, revision: 0, creatures: {}, players: {}, lastStepAt: 0 };
}
export function newCreaturePlayer() {
  return { health: 100, hunger: 100, bag: {}, lastActionAt: 0, lastFightAt: 0, lastForageAt: 0,
    lastHurtAt: 0, downedUntil: 0, attackerId: null };
}
const CREATURE_FIELDS = ['id','species','x','y','z','yaw','health','hunger','fear','boldness','temperament','trust','ownerId',
  'behavior','command','active','harvested','touched','lastPositiveAt','lastAttackAt','lastHurtAt','lastSimAt',
  'threatId','speed','scale','age','bag','homeX','homeZ'];
const PLAYER_FIELDS = ['health','hunger','bag','lastActionAt','lastFightAt','lastForageAt','lastHurtAt','downedUntil','attackerId'];
export function validCreatureState(state) {
  if (!keys(state, ['version','seed','revision','creatures','players','lastStepAt']) || state.version !== 1
    || !Number.isSafeInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff || !timestamp(state.revision)
    || !timestamp(state.lastStepAt) || !plain(state.creatures) || !plain(state.players)
    || Object.keys(state.creatures).length > MAX_CREATURE_RECORDS || Object.keys(state.players).length > MAX_CREATURE_PLAYERS) return false;
  let active = 0;
  for (const [id, c] of Object.entries(state.creatures)) {
    const species = CREATURE_SPECIES[c?.species];
    if (!validEntityId(id) || !keys(c, CREATURE_FIELDS) || c.id !== id || !species
      || !['x','z','homeX','homeZ'].every(key => finite(c[key], -1000000, 1000000)) || !finite(c.y, -64, 256)
      || !finite(c.yaw, -Math.PI, Math.PI) || !finite(c.health, 0, species.health) || !finite(c.hunger, 0, 100)
      || !finite(c.fear, 0, 100) || !finite(c.boldness, 0, 1) || !['shy','calm','bold','territorial'].includes(c.temperament)
      || !plain(c.trust) || Object.keys(c.trust).length > 8
      || !Object.entries(c.trust).every(([owner, trust]) => validEntityId(owner) && Number.isInteger(trust) && trust >= 0 && trust <= 100)
      || !(c.ownerId === null || validEntityId(c.ownerId)) || !CREATURE_BEHAVIORS.includes(c.behavior)
      || !['follow','stay'].includes(c.command) || !['active','harvested','touched'].every(key => typeof c[key] === 'boolean')
      || !['lastPositiveAt','lastAttackAt','lastHurtAt','lastSimAt'].every(key => timestamp(c[key]))
      || !(c.threatId === null || (typeof c.threatId === 'string' && /^[pc]:/.test(c.threatId) && validEntityId(c.threatId.slice(2))))
      || !finite(c.speed, 0, species.sprint + .01) || c.scale !== 1 || c.age !== 'adult' || !validInventory(c.bag, species.carry)
      || (c.health === 0 && c.behavior !== 'dead') || (c.health > 0 && c.behavior === 'dead')
      || (c.harvested && (c.health !== 0 || c.active)) || ((c.health === 0 || c.ownerId !== null || c.harvested) && !c.touched)) return false;
    if (c.active) active++;
  }
  if (active > MAX_CREATURES) return false;
  for (const [id, player] of Object.entries(state.players)) {
    if (!validEntityId(id) || !keys(player, PLAYER_FIELDS) || !finite(player.health, 0, 100) || !finite(player.hunger, 0, 100)
      || !validInventory(player.bag, PLAYER_BAG_CAPACITY)
      || !['lastActionAt','lastFightAt','lastForageAt','lastHurtAt','downedUntil'].every(key => timestamp(player[key]))
      || !(player.attackerId === null || validEntityId(player.attackerId))) return false;
  }
  return true;
}

function add(bag, id, count) { bag[id] = (bag[id] ?? 0) + count; if (!bag[id]) delete bag[id]; }
function within(position, creature, range = 5) {
  return Math.hypot(position.x - creature.x, position.z - creature.z) <= range && Math.abs(position.y - creature.y) < 5;
}
function hasForage(context) {
  const { position, surfaceHeight, getBlock } = context;
  if (typeof surfaceHeight !== 'function' || typeof getBlock !== 'function' || getRegion(position.x, position.z).id !== 'hearthwood') return false;
  const x = Math.floor(position.x), z = Math.floor(position.z), ground = surfaceHeight(x, z);
  if (getBlock(x, ground, z) !== 1 || Math.abs(position.y - ground - 1) > 2) return false;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const base = surfaceHeight(x + dx, z + dz);
    for (let y = base + 2; y <= base + 7; y++) if (getBlock(x + dx, y, z + dz) === 5) return true;
  }
  return false;
}

// Atomic host transaction. Client-supplied damage, timestamps and owner IDs are never used.
export function creatureAction(state, supplies, intent, context = {}) {
  const fail = reason => ({ ok: false, reason, state, supplies });
  if (!validCreatureState(state) || !validInventory(supplies)) return fail('Creature state or camp inventory is invalid');
  const { actorId, position, now } = context;
  if (!validEntityId(actorId) || !position || !['x','y','z'].every(axis => finite(position[axis], -1000000, 1000000)) || !timestamp(now) || now > Number.MAX_SAFE_INTEGER - 60000) return fail('Player position or host time is unavailable');
  if (!intent || !CREATURE_ACTIONS.includes(intent.action)) return fail('Unknown creature action');
  if (!own(state.players, actorId) && Object.keys(state.players).length >= MAX_CREATURE_PLAYERS) return fail('This expedition has reached its keeper limit');
  const next = structuredClone(state), stock = { ...supplies }, player = next.players[actorId] ??= newCreaturePlayer();
  if (now < player.lastActionAt || (player.lastActionAt && now - player.lastActionAt < 250)) return fail('Wait a moment before acting again');
  const action = intent.action;
  if (action === 'recover') {
    if (player.health > 0) return fail('You are already on your feet');
    if (now < player.downedUntil) return fail('Catch your breath before recovering');
    player.health = 60; player.hunger = Math.max(30, player.hunger); player.downedUntil = now + 6000; player.attackerId = null;
  } else {
    if (player.health <= 0) return fail('Recover before taking another action');
    if (['deposit','withdraw'].includes(action)) {
      const { itemId, count } = intent;
      if (!SUPPLY_IDS.includes(itemId) || !Number.isSafeInteger(count) || count < 1 || count > MAX_STACK) return fail('Choose a valid item quantity');
      const source = action === 'deposit' ? player.bag : stock, target = action === 'deposit' ? stock : player.bag;
      if ((source[itemId] ?? 0) < count) return fail('There are not enough items to transfer');
      if ((target[itemId] ?? 0) + count > MAX_STACK || (action === 'withdraw' && bagCount(target) + count > PLAYER_BAG_CAPACITY)) return fail('The destination has no room for those items');
      add(source, itemId, -count); add(target, itemId, count);
    } else if (action === 'eat') {
      const food = { [P.RAW_MEAT]: [20, 8], [P.COOKED_MEAT]: [40, 24], [P.FORAGE]: [12, 4] }[intent.itemId];
      if (!food || !(player.bag[intent.itemId] > 0)) return fail('Carry an edible provision first');
      if (player.hunger >= 100 && player.health >= 100) return fail('You are already healthy and well fed');
      add(player.bag, intent.itemId, -1); player.hunger = Math.min(100, player.hunger + food[0]); player.health = Math.min(100, player.health + food[1]);
    } else if (action === 'forage') {
      if (player.lastForageAt && now - player.lastForageAt < 15000) return fail('Give the plants a moment before gathering again');
      if (!hasForage(context)) return fail('Find grassy ground beside living woodland foliage to forage');
      const helper = Object.values(next.creatures).some(c => c.ownerId === actorId && c.species === 'moonstag' && c.health > 0 && c.active && within(position, c, 8));
      const count = helper ? 3 : 2;
      if (bagCount(player.bag) + count > PLAYER_BAG_CAPACITY) return fail('Your carried bag is full');
      add(player.bag, P.FORAGE, count); player.lastForageAt = now;
    } else {
      const c = validEntityId(intent.targetId) && own(next.creatures, intent.targetId) ? next.creatures[intent.targetId] : null;
      if (!c || !c.active || c.harvested || !within(position, c)) return fail('Move within five metres of that creature');
      if (context.canReach?.(position, c) === false) return fail('A wall or obstacle blocks your reach');
      const species = CREATURE_SPECIES[c.species], owned = c.ownerId === actorId;
      if (['fight','harvest','follow','stay','release','load','unload'].includes(action) && c.ownerId && !owned) return fail('That companion belongs to another keeper');
      if (['fight','harvest'].includes(action) && owned && intent.confirm !== true) return fail('Confirm this action against your own companion');
      if (action === 'harvest') {
        if (context.tool !== 'axe') return fail('Equip your axe to harvest the fallen creature');
        if (c.health > 0) return fail('Only a defeated creature can be harvested');
        const loot = { ...species.resources };
        for (const [id, count] of Object.entries(c.bag)) loot[id] = (loot[id] ?? 0) + count;
        if (bagCount(player.bag) + bagCount(loot) > PLAYER_BAG_CAPACITY) return fail('Make room in your carried bag before harvesting');
        for (const [id, count] of Object.entries(loot)) add(player.bag, id, count);
        c.bag = {}; c.harvested = true; c.active = false;
      } else {
        if (c.health <= 0 && action !== 'unload') return fail('This creature has fallen');
        if (action === 'fight') {
          if (!['axe','hand'].includes(context.tool)) return fail('Equip your axe before fighting');
          if (player.lastFightAt && now - player.lastFightAt < 750) return fail('Wait for your next swing');
          c.health = Math.max(0, c.health - (context.tool === 'axe' ? 18 : 4));
          c.fear = Math.min(100, c.fear + 25); c.lastHurtAt = now; c.threatId = `p:${actorId}`;
          if (own(c.trust, actorId)) c.trust[actorId] = Math.max(0, c.trust[actorId] - 40);
          player.lastFightAt = now;
          c.behavior = c.health === 0 ? 'dead' : c.temperament === 'shy' || owned ? 'fleeing' : 'defending';
          if (!c.health) { c.speed = 0; c.threatId = null; }
        } else if (action === 'feed' || action === 'care') {
          if (c.lastPositiveAt && now - c.lastPositiveAt < 8000) return fail('Give this creature time to respond before another kindness');
          if (!own(c.trust, actorId) && Object.keys(c.trust).length >= 8) return fail('This creature already knows eight keepers');
          const itemId = action === 'care' ? P.FORAGE : intent.itemId;
          if (action === 'feed' && (!species.diet.includes(itemId) || c.hunger >= 95)) return fail(c.hunger >= 95 ? 'This creature is already well fed' : 'Choose food from this species’ diet');
          const trustGain = action === 'care' && c.health >= species.health - 1 ? 10 : 20;
          if (!(player.bag[itemId] > 0)) return fail('Carry the needed provision before helping');
          add(player.bag, itemId, -1); c.lastPositiveAt = now; c.fear = Math.max(0, c.fear - 25);
          if (action === 'feed') c.hunger = Math.min(100, c.hunger + 20);
          else c.health = Math.min(species.health, c.health + 18);
          c.trust[actorId] = Math.min(100, (c.trust[actorId] ?? 0) + trustGain);
          if (!c.ownerId && c.trust[actorId] >= 60) c.ownerId = actorId;
          c.threatId = null; c.behavior = c.ownerId ? 'following' : 'social';
        } else if (['follow','stay','release'].includes(action)) {
          if (!owned) return fail('Earn this creature’s trust before giving companion commands');
          if (action === 'release') { c.ownerId = null; c.behavior = 'wandering'; }
          else { c.command = action; c.behavior = action === 'follow' ? 'following' : 'staying'; }
          c.threatId = null;
        } else if (action === 'load' || action === 'unload') {
          if (!owned) return fail('Only your own companion can carry your supplies');
          const { itemId, count } = intent;
          if (!SUPPLY_IDS.includes(itemId) || !Number.isSafeInteger(count) || count < 1 || count > MAX_STACK) return fail('Choose a valid item quantity');
          const source = action === 'load' ? player.bag : c.bag, target = action === 'load' ? c.bag : player.bag;
          const capacity = action === 'load' ? species.carry : PLAYER_BAG_CAPACITY;
          if ((source[itemId] ?? 0) < count) return fail('There are not enough carried items');
          if (bagCount(target) + count > capacity) return fail('The destination bag is full');
          add(source, itemId, -count); add(target, itemId, count);
        }
      }
      c.touched = true;
    }
  }
  player.lastActionAt = now;
  return { ok: true, state: next, supplies: stock };
}
