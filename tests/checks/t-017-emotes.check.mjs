// blocktopia:T-017 check: emotes and pings. Players say "wave", "come here" and so on without any words typed;
// room-mates see it over the sender within 300 ms; a quiet switch hides others' emotes; no text can get through.
// Run: node --test tests/checks/t-017-emotes.check.mjs   Needs Docker + local Supabase (`npm run play` once) and Chrome.
// Real build of this tree, real browsers, real WebRTC room, real local DB. Local database only.
//
// INTERFACE the worker builds (only under ?diagnostics, like __THREE_GAME_DIAGNOSTICS__):
//   window.__SOCIAL_DIAGNOSTICS__ = {
//     me: '<this player id>',                                     // session.playerId
//     quiet: boolean,                                             // the quiet switch is on
//     seen: [{ from: '<player id>', kind: 'emote' | 'ping', id, at: Date.now() when drawn here,
//              position: [x, y, z] where it is drawn, meshId: uuid of its three.js object }],   // others' emotes/pings drawn here
//     sendRaw(payload) }    // sends `payload` UNCHANGED through the same channel real emotes use (no sender-side checks),
//                           // so the check can prove every receiver, host relay included, drops forged text or unknown ids
//   Buttons: #open-emotes opens the wheel #emote-wheel; inside it `[data-emote="<id>"]` (6: wave love sit cheer laugh dance)
//   and `[data-ping="<id>"]` (3: come look help); `[data-quiet]` toggles quiet (aria-pressed true/false).
//   An on-screen dot `[data-locator="<player id>"]` per room-mate.
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
const RUN = Date.now().toString(36), PASSWORD = 'Emotes-Local-1!';
const email = who => `t017-${who}-${RUN}@example.test`;
const sql = q => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-tAc', q], { encoding: 'utf8' }).trim();
const EMOTES = ['wave', 'love', 'sit', 'cheer', 'laugh', 'dance'], PINGS = ['come', 'look', 'help'];
const FORGED = `meet me at the park ${RUN}`; // text a stranger might try to send

const dist = mkdtempSync(join(tmpdir(), 'bt-t017-'));
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
  const who = `(select id from auth.users where email like 't017-%-${RUN}@example.test')`;
  try { sql(`delete from public.blocktopia_room_actors where user_id in ${who}; delete from public.saved_expeditions where user_id in ${who}; delete from auth.users where email like 't017-%-${RUN}@example.test';`); }
  catch (e) { console.error(`t-017: could not remove this run's test players: ${e.message.slice(0, 200)}`); }
});

const wait = ms => new Promise(r => setTimeout(r, ms));
const social = p => p.evaluate(() => window.__SOCIAL_DIAGNOSTICS__ ?? null);
const pos = p => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.debug.player.position.toArray());
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const visible = (p, id) => p.evaluate(id => { let o = window.__THREE_GAME_DIAGNOSTICS__.debug.scene.getObjectByProperty('uuid', id); if (!o) return false; for (; o; o = o.parent) if (!o.visible) return false; return true; }, id);

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
  if (!await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 10_000 }).catch(() => null)) {
    await p.click('#account-switch'); await p.fill('#account-email', email(who)); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
    await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 60_000 });
  }
}
async function enter(p, code) {
  if (code) { await p.fill('#room-code', code); await p.click('#join-room'); } else await p.click('#create-room');
  // The button starts enabled before the game builds; wait for the gate to show and the textures to load.
  await p.waitForFunction(() => !document.getElementById('play-gate').hidden && !document.getElementById('click-to-play').disabled, null, { timeout: 120_000 });
  await p.click('#click-to-play');
  await p.waitForSelector('#play-gate', { state: 'hidden', timeout: 15_000 });
  await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.world?.position, null, { timeout: 60_000 });
  await p.evaluate(() => { const pl = window.__THREE_GAME_DIAGNOSTICS__.debug.player; if (!pl.active) pl.setActive(true); });
  await wait(2000);
  return code ?? new URL(await p.inputValue('#invite-url')).searchParams.get('room');
}
// Stand `p` 4 blocks from `q` so each is in the other's view distance.
async function besides(p, q, dx) {
  const [x, y, z] = await pos(q);
  await p.evaluate(([x, y, z]) => { window.__THREE_GAME_DIAGNOSTICS__.debug.player.position.set(x, y + 1, z); }, [x + dx, y, z]);
}
// Press a wheel button on `p`; return the time just before the press.
async function press(p, sel) {
  if (!await p.locator('#emote-wheel').isVisible()) await p.click('#open-emotes');
  const b = p.locator(`#emote-wheel ${sel}`);
  await b.waitFor({ state: 'visible', timeout: 5000 });
  const t0 = Date.now(); await (p.isMobile ? b.tap() : b.click()); return t0;
}
// Wait until `p` has drawn a new entry from `from` matching `id`; return it (or null after `ms`).
async function sees(p, from, id, after0, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = (await social(p))?.seen?.find(s => s.from === from && s.id === id && s.at >= after0);
    if (hit) return hit;
    await wait(20);
  }
  return null;
}

// Two players per room: a desktop host and a phone guest. A third player does not reach the world in this local
// harness today (it connects to the host but is never admitted; ticket T-026 looks for the cause), so no condition here needs one.
let host, b, code, ids = {};

test('1. room-mates see an emote over the sender, and a ping, within 300 ms; each room-mate has a locator dot; phone buttons are big enough', { timeout: 420_000 }, async () => {
  host = await player('host'); code = await enter(host);
  b = await player('b', { phone: true }); b.isMobile = true; await enter(b, code);
  for (const [n, p] of [['host', host], ['b', b]]) {
    const s = await social(p); assert.ok(s?.me, `${n}: no __SOCIAL_DIAGNOSTICS__.me (emotes are not built)`); ids[n] = s.me;
  }
  await besides(b, host, 4); await wait(4000);
  await b.click('#open-emotes').catch(() => assert.fail('no #open-emotes button on the phone'));
  for (const sel of [...EMOTES.map(e => `[data-emote="${e}"]`), ...PINGS.map(e => `[data-ping="${e}"]`), '[data-quiet]']) {
    const box = await b.locator(`#emote-wheel ${sel}`).boundingBox();
    assert.ok(box, `the wheel has no ${sel}`);
    assert.ok(box.width >= 48 && box.height >= 48, `${sel} is ${box.width}x${box.height} px on a 412x915 phone (want >= 48x48)`);
  }
  await b.keyboard.press('Escape');
  for (const [n, p, m] of [['host', host, 'b'], ['b', b, 'host']]) {
    assert.ok(await p.locator(`[data-locator="${ids[m]}"]`).isVisible(), `${n}: no visible locator dot for room-mate ${m}`);
  }
  const lag = [];
  for (const [sender, sp, n, p, emote] of [['host', host, 'b', b, 'wave'], ['b', b, 'host', host, 'cheer'], ['host', host, 'b', b, 'dance']]) {
    const t0 = await press(sp, `[data-emote="${emote}"]`);
    const at = await pos(sp);
    const hit = await sees(p, ids[sender], emote, t0);
    assert.ok(hit, `${n} never drew ${sender}'s "${emote}"`);
    lag.push(hit.at - t0);
    assert.equal(hit.kind, 'emote');
    assert.ok(hit.at - t0 <= 300, `${n} drew ${sender}'s "${emote}" ${hit.at - t0} ms after the press (want <= 300)`);
    assert.ok(dist3(hit.position, at) <= 3 && hit.position[1] > at[1], `${n} drew ${sender}'s "${emote}" at ${hit.position}, not over ${sender} at ${at}`);
    assert.ok(await visible(p, hit.meshId), `${n}: ${sender}'s "${emote}" is not a visible object in the scene`);
  }
  for (const [sender, sp, n, p, ping] of [['host', host, 'b', b, 'come'], ['b', b, 'host', host, 'help']]) {
    const t1 = await press(sp, `[data-ping="${ping}"]`);
    const hit = await sees(p, ids[sender], ping, t1);
    assert.ok(hit?.kind === 'ping', `${n} never drew ${sender}'s "${ping}" ping`);
    assert.ok(hit.at - t1 <= 300, `${n} drew ${sender}'s "${ping}" ping ${hit.at - t1} ms after the press (want <= 300)`);
    assert.ok(await visible(p, hit.meshId), `${n}: ${sender}'s "${ping}" ping is not a visible object in the scene`);
  }
  console.log(`t-017: emote press-to-drawn ms: ${lag.join(', ')}`);
  await wait(5000);
  const old = (await social(b)).seen.find(s => s.from === ids.host && s.id === 'wave');
  assert.ok(!await visible(b, old.meshId), 'the host\'s "wave" is still showing 5 s later (it should fade after about 3 s)');
});

test('2. quiet hides other players\' emotes and pings, and stays on after a reload', { timeout: 300_000 }, async () => {
  assert.ok(ids.host, 'no room from test 1');
  await press(b, '[data-quiet]');
  assert.equal((await social(b)).quiet, true, 'the quiet switch did not turn quiet on');
  await b.keyboard.press('Escape');
  let t0 = await press(b, '[data-emote="sit"]'); // quiet stops what b sees, not what b may send
  assert.ok(await sees(host, ids.b, 'sit', t0), 'the host did not see the quiet player\'s own "sit"');
  t0 = await press(host, '[data-emote="laugh"]');
  assert.equal(await sees(b, ids.host, 'laugh', t0, 1500), null, 'b (quiet) still drew the host\'s "laugh"');
  await b.reload({ waitUntil: 'load' }); await signIn(b, 'b'); await enter(b, code); await besides(b, host, 4); await wait(4000);
  assert.equal((await social(b))?.quiet, true, 'quiet was off again after a reload');
  ids.b = (await social(b)).me;
  t0 = await press(host, '[data-ping="look"]');
  assert.equal(await sees(b, ids.host, 'look', t0, 1500), null, 'b (quiet, after reload) still drew the host\'s "look" ping');
  t0 = await press(host, '[data-emote="wave"]');
  assert.equal(await sees(b, ids.host, 'wave', t0, 1500), null, 'b (quiet, after reload) still drew the host\'s "wave"');
  await press(b, '[data-quiet]'); await b.keyboard.press('Escape');
  t0 = await press(host, '[data-emote="love"]');
  assert.ok(await sees(b, ids.host, 'love', t0), 'b turned quiet off but still sees no emotes');
});

test('3. no text path: the wheel has no text box, and forged text or unknown ids from the host or a guest reach no one', { timeout: 300_000 }, async () => {
  assert.ok(ids.host, 'no room from test 1');
  for (const [n, p] of [['host', host], ['b', b]]) {
    if (!await p.locator('#emote-wheel').isVisible()) await p.click('#open-emotes');
    const boxes = await p.$$eval('#emote-wheel input:not([type=button]):not([type=checkbox]), #emote-wheel textarea, #emote-wheel [contenteditable=""], #emote-wheel [contenteditable=true]', e => e.length);
    assert.equal(boxes, 0, `${n}: the emote wheel has a text box`);
    await p.keyboard.press('Escape');
  }
  const forged = [
    { kind: 'emote', id: FORGED }, { kind: 'ping', id: FORGED }, { kind: 'emote', id: 'wave', text: FORGED, label: FORGED },
    { kind: 'emote', id: 'zzz-unknown' }, { kind: FORGED, id: 'wave' },
  ];
  for (const [sender, sp, n, p] of [['host', host, 'b', b], ['b', b, 'host', host]]) { // b is a guest on a phone
    const t0 = Date.now();
    for (const f of forged) await sp.evaluate(f => window.__SOCIAL_DIAGNOSTICS__.sendRaw(f), f);
    await wait(2000);
    const fresh = (await social(p)).seen.filter(x => x.from === ids[sender] && x.at >= t0);
    const bad = fresh.filter(x => !(x.kind === 'emote' ? EMOTES : PINGS).includes(x.id) || JSON.stringify(x).includes(FORGED));
    assert.deepEqual(bad, [], `${n} drew forged messages from ${sender}: ${JSON.stringify(bad)}`);
    assert.ok(!(await p.evaluate(() => document.body.innerText)).includes(FORGED), `${n}'s page shows the forged text sent by ${sender}`);
  }
});
