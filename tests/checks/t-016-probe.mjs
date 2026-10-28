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


test('probe', { timeout: 300_000 }, async () => {
  const owner = await player('owner');
  owner.on('console', m => { if (['error','warning'].includes(m.type())) console.log('PAGE', m.type(), m.text().slice(0,300)); });
  owner.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,300)));
  await enter(owner);
  console.log('first', JSON.stringify(await pets(owner)));
  await wait(3000);
  await owner.reload({ waitUntil: 'load' });
  await signIn(owner, 'owner');
  console.log('after signin');
  await enter(owner).catch(async e => { console.log('ENTER FAIL', await owner.evaluate(() => JSON.stringify({keys: Object.keys(window.__THREE_GAME_DIAGNOSTICS__||{}), startup: window.__THREE_GAME_DIAGNOSTICS__?.startup, gate: document.getElementById('play-gate')?.hidden, status: document.getElementById('menu-status')?.textContent, lobby: document.getElementById('lobby-status')?.textContent}))); });
  console.log('second', JSON.stringify(await pets(owner)));
});
