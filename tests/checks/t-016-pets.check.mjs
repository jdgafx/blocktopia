// blocktopia:T-016 check: pets. A new player's egg hatches into Pip by walking; Pip follows, friends see and pat it; it saves.
// Run: node --test tests/checks/t-016-pets.check.mjs   Needs Docker + local Supabase (`npm run play` once) and Chrome.
// Real build of this tree, real browser, real local DB, real keyboard walking. Local database only.
// Two players per room at most: a third joiner is not admitted in this harness today (ticket T-026 looks for why).
//
// INTERFACE the worker builds (only under ?diagnostics, like __THREE_GAME_DIAGNOSTICS__; main.js may stay untouched):
//   window.__PET_DIAGNOSTICS__ = {
//     mine: { stage: 'egg' | 'pet', progress: 0..1 (egg only; 1 = hatch), name, species, trust: number,
//             position: [x, y, z] (pet only) },                                 // this player's own egg or pet
//     seen: [{ name, ownerId, position: [x, y, z], meshId }] }              // other players' pets drawn here;
//                                                                             // meshId = uuid of its three.js object
//   A pat button `button[data-action="pat"]` shows while the player stands within 3 blocks of someone else's pet.
//   Creature panel buttons carry `data-action="<action>"` (one attribute in button() of src/ui/creatures.js).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const { chromium } = await import('playwright-core');
const supa = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = supa.API_URL, KEY = supa.PUBLISHABLE_KEY || supa.ANON_KEY;
assert.match(API, /^http:\/\/(127\.0\.0\.1|localhost)[:/]/, 'this check runs on the local database only');
const DB = `supabase_db_${readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)[1]}`;
const RUN = Date.now().toString(36), PASSWORD = 'Pets-Local-1!';
const email = who => `t016-${who}-${RUN}@example.test`;
const sql = q => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-tAc', q], { encoding: 'utf8' }).trim();

// Build this tree and serve it the way production does (COOP/COEP + the real CSP, plus the local DB origin).
const dist = mkdtempSync(join(tmpdir(), 'bt-t016-'));
execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: KEY } });
const origin = new URL(API).origin;
const csp = readFileSync(join(ROOT, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1].replace('connect-src', `connect-src ${origin} ${origin.replace('http', 'ws')}`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let f = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) f = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Content-Security-Policy': csp });
  res.end(readFileSync(f));
});
const URL0 = await new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const browser = await chromium.launch({ headless: true, executablePath: execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim(),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=Vulkan', '--use-angle=gl'] });

after(async () => {
  await browser.close().catch(() => {}); server.close(); rmSync(dist, { recursive: true, force: true });
  const who = `(select id from auth.users where email like 't016-%-${RUN}@example.test')`;
  try { sql(`delete from public.blocktopia_room_actors where user_id in ${who}; delete from public.saved_expeditions where user_id in ${who}; delete from auth.users where email like 't016-%-${RUN}@example.test';`); }
  catch (e) { console.error(`t-016: could not remove this run's test players: ${e.message.slice(0, 200)}`); }
});

const wait = ms => new Promise(r => setTimeout(r, ms));
const pets = p => p.evaluate(() => window.__PET_DIAGNOSTICS__ ?? null);
const pos = p => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.debug.player.position.toArray());
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

async function player(who, { phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(120_000);
  await p.goto(`${URL0}/?diagnostics`, { waitUntil: 'load' });
  await signIn(p, who);
  return p;
}
async function signIn(p, who) {
  if (await p.locator('#room-lobby:not([hidden])').isVisible()) return;
  await p.waitForSelector('#account-form');
  await p.fill('#account-email', email(who)); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
  if (!await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 10_000 }).catch(() => null)) { // a new player: sign up instead
    await p.click('#account-switch'); await p.fill('#account-email', email(who)); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
    await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 60_000 });
  }
}
// Enter a world: a new room, or the room `code` (typed into the room code box, as an invited friend does).
async function enter(p, code) {
  if (code) { await p.fill('#room-code', code); await p.click('#join-room'); } else await p.click('#create-room');
  // The button starts enabled before the game builds; wait for the gate to show and the textures to load.
  await p.waitForFunction(() => !document.getElementById('play-gate').hidden && !document.getElementById('click-to-play').disabled, null, { timeout: 120_000 });
  await p.click('#click-to-play');
  await p.waitForSelector('#play-gate', { state: 'hidden', timeout: 15_000 });
  await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.world?.position, null, { timeout: 60_000 });
  await p.evaluate(() => { const pl = window.__THREE_GAME_DIAGNOSTICS__.debug.player; if (!pl.active) pl.setActive(true); }); // headless has no pointer lock
  await wait(2000);
  return code ?? new URL(await p.inputValue('#invite-url')).searchParams.get('room');
}
// Walk with real key presses. Returns the player's path length in blocks (flat), sampled every 250 ms.
async function walk(p, ms, how = 'roam') {
  let walked = 0, last = await pos(p), t0 = Date.now(), turn = 0;
  await p.keyboard.down('KeyW');
  try {
    while (Date.now() - t0 < ms) {
      const t = Date.now() - t0;
      if (how === 'roam' && Math.floor(t / 12_000) > turn) { turn++; await p.evaluate(() => { window.__THREE_GAME_DIAGNOSTICS__.debug.player._yaw += 1.3; }); }
      if (how === 'roam' && t % 1500 < 250) await p.keyboard.press('Space'); // hop over one-block steps
      if (how === 'circle') await p.evaluate(() => { window.__THREE_GAME_DIAGNOSTICS__.debug.player._yaw += 0.6; }); // ~2.4 rad/s: a circle a few blocks wide
      if (how === 'backforth' && t % 3000 < 250) { await p.keyboard.up('KeyW'); await p.keyboard.down('KeyS'); await wait(1500); await p.keyboard.up('KeyS'); await p.keyboard.down('KeyW'); }
      await wait(250);
      const now = await pos(p); walked += flat(now, last); last = now;
    }
  } finally { await p.keyboard.up('KeyW'); await p.keyboard.up('KeyS'); }
  return walked;
}
// Jumps far faster than running: 10 moves of 150 blocks, one per second.
async function teleport(p) {
  for (let i = 0; i < 10; i++) { await p.evaluate(() => { const pl = window.__THREE_GAME_DIAGNOSTICS__.debug.player; pl.position.x += 150; pl.position.y = 60; }); await wait(1000); }
}

let owner, code, hatched, friend;

test('1. a new player gets an egg that hatches into Pip after about 60-90 s of real walking; circles, back-and-forth and teleports do not hatch it', { timeout: 420_000 }, async () => {
  owner = await player('owner');
  code = await enter(owner);
  const start = await pets(owner);
  assert.ok(start?.mine, 'no __PET_DIAGNOSTICS__.mine: a new player has no egg (or pets are not built)');
  assert.equal(start.mine.stage, 'egg', `a new player should start with an egg, got ${JSON.stringify(start.mine)}`);
  assert.ok(start.mine.progress < 0.05, `a new egg starts near 0, got ${start.mine.progress}`);
  await walk(owner, 30_000, 'circle'); await walk(owner, 30_000, 'backforth'); await teleport(owner);
  const cheat = (await pets(owner)).mine;
  assert.equal(cheat.stage, 'egg', 'the egg hatched from circles, back-and-forth or teleports');
  assert.ok(cheat.progress < 0.15, `circles, back-and-forth and teleports moved the egg to ${cheat.progress} (want < 0.15)`);
  let walkedMs = 0, path = 0;
  while (walkedMs < 100_000 && (await pets(owner)).mine.stage === 'egg') { path += await walk(owner, 5000); walkedMs += 5000; }
  assert.ok(path > 100, `the player walked only ${path.toFixed(0)} blocks in ${walkedMs / 1000} s: the walk itself did not work`);
  hatched = (await pets(owner)).mine;
  assert.equal(hatched.stage, 'pet', `no hatch after ${walkedMs / 1000} s of walking (${path.toFixed(0)} blocks); progress ${hatched.progress}`);
  assert.ok(walkedMs >= 45_000, `hatched after only ${walkedMs / 1000} s of walking (want about 60-90 s)`);
  assert.ok(hatched.name && hatched.species, `the pet needs a name and species, got ${JSON.stringify(hatched)}`);
});

test('2. Pip follows its owner on land and through water; a friend who joins by room code sees Pip by its owner and can pat it, and the owner sees trust go up', { timeout: 300_000 }, async () => {
  assert.ok(hatched?.stage === 'pet', 'no pet hatched in test 1');
  await wait(3000);
  let me = (await pets(owner)).mine;
  assert.ok(me.position && flat(me.position, await pos(owner)) <= 6, `after walking, Pip is ${me.position ? flat(me.position, await pos(owner)).toFixed(1) : '?'} blocks from its owner (want <= 6)`);
  const water = (await owner.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.waters))[0];
  if (water) { // swim across the nearest loaded water, then check Pip came along
    await owner.evaluate(([x, y, z]) => { const pl = window.__THREE_GAME_DIAGNOSTICS__.debug.player; pl.position.set(x + 0.5, y + 1, z + 0.5); }, water);
    await wait(3000); await walk(owner, 8000, 'swim'); await wait(4000);
    me = (await pets(owner)).mine;
    assert.ok(flat(me.position, await pos(owner)) <= 6, `after swimming, Pip is ${flat(me.position, await pos(owner)).toFixed(1)} blocks from its owner (want <= 6)`);
  } else console.log('t-016: no water loaded near the owner; the swim part was skipped this run');
  friend = await player('friend', { phone: true });
  await enter(friend, code);
  const near = await pos(owner);
  await friend.evaluate(([x, y, z]) => { window.__THREE_GAME_DIAGNOSTICS__.debug.player.position.set(x + 2, y + 1, z); }, near);
  await friend.waitForFunction(() => window.__PET_DIAGNOSTICS__?.seen?.length > 0, null, { timeout: 30_000, polling: 250 }).catch(() => {}); // the joiner connects after the 10 s ICE gather
  const seen = (await pets(friend))?.seen?.find(s => s.name === hatched.name);
  assert.ok(seen, `the friend sees no pet named ${hatched.name}: ${JSON.stringify((await pets(friend))?.seen)}`);
  assert.ok(flat(seen.position, await pos(owner)) <= 7, `the friend sees Pip ${flat(seen.position, await pos(owner)).toFixed(1)} blocks from its owner (want <= 7)`);
  const drawn = await friend.evaluate(id => { let o = window.__THREE_GAME_DIAGNOSTICS__.debug.scene.getObjectByProperty('uuid', id); if (!o) return false; for (; o; o = o.parent) if (!o.visible) return false; return true; }, seen.meshId);
  assert.ok(drawn, 'the pet the friend "sees" is not a visible object in the friend\'s scene');
  const pat = friend.locator('button[data-action="pat"]');
  await pat.waitFor({ state: 'visible', timeout: 5000 }).catch(() => assert.fail('no pat button for the friend standing 2 blocks from Pip'));
  const box = await pat.boundingBox();
  assert.ok(box.width >= 48 && box.height >= 48, `the pat button is ${box.width}x${box.height} px on a 412x915 phone (want >= 48x48)`);
  const before = (await pets(owner)).mine.trust;
  await pat.tap();
  await owner.waitForFunction(t => window.__PET_DIAGNOSTICS__.mine.trust > t, before, { timeout: 5000 }).catch(() => assert.fail(`the owner's Pip trust stayed ${before} after the friend's pat`));
});

test('3. nobody can fight, harvest or release Pip; Pip and egg progress survive a reload', { timeout: 300_000 }, async () => {
  assert.ok(hatched?.stage === 'pet', 'no pet hatched in test 1');
  for (const [who, p] of [['owner', owner], ['friend', friend]]) {
    if (!p) continue;
    await p.keyboard.press('KeyC');
    await p.waitForSelector('#creature-panel[open]', { timeout: 5000 }).catch(() => assert.fail(`${who}: C next to Pip opened no creature panel`));
    assert.ok((await p.textContent('#creature-panel')).includes(hatched.name), `${who}: the creature panel next to Pip does not show Pip`);
    const actions = await p.$$eval('#creature-panel button[data-action]', bs => bs.map(b => b.dataset.action));
    assert.ok(actions.length, `${who}: creature panel buttons carry no data-action`);
    const harm = actions.filter(a => ['fight', 'harvest', 'release'].includes(a));
    assert.deepEqual(harm, [], `${who}: Pip's panel offers ${harm.join(', ')}`);
    await p.keyboard.press('Escape');
  }
  await owner.reload({ waitUntil: 'load' }); await signIn(owner, 'owner'); await enter(owner);
  const back = (await pets(owner))?.mine;
  assert.equal(back?.stage, 'pet', `after a reload the owner has ${JSON.stringify(back)}, not Pip`);
  assert.equal(back.name, hatched.name, 'the pet came back with another name');
  assert.ok(back.trust >= hatched.trust, `trust went down over a reload: ${hatched.trust} -> ${back.trust}`);
  const second = await player('egg');
  await enter(second); await walk(second, 25_000);
  const mid = (await pets(second)).mine;
  assert.ok(mid.stage === 'egg' && mid.progress >= 0.1, `25 s of walking moved a new egg only to ${mid.progress}`);
  await second.reload({ waitUntil: 'load' }); await signIn(second, 'egg'); await enter(second);
  const kept = (await pets(second)).mine;
  assert.ok(kept.progress >= mid.progress - 0.05, `egg progress fell over a reload: ${mid.progress} -> ${kept.progress}`);
});
