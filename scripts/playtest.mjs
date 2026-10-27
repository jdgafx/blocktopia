// Local-only speed check: builds OLD (git ref PLAYTEST_OLD_REF, default feature/core-engine) and NEW (this working tree),
// plays both on laptop and phone profiles over real Intel WebGPU and forced WebGL2, in turns (old, new, old, new ...).
// - Work per frame: renderer draw calls and triangles on a route scripted by frame number (virtual clock, seeded random,
//   auto quality pinned), so the same code gives the same counts on any host load.
// - Speed: time inside the game's frame callback, OLD vs NEW in the same run, so host load hits both alike.
// Ends with exactly one line: PLAYTEST PASSED (exit 0) or PLAYTEST FAILED (exit 1), also after a refusal or a setup error. Usage: npm run playtest
// Run length: PLAYTEST_MAX_MS (default 9 min) is shared out over the four runs; each takes as many rounds as its share allows (at least MIN_ROUNDS).
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);
// playwright-core: from this tree, else from the checkout this worktree belongs to (a temp copy of a commit has no node_modules of its own).
const { chromium } = await (async () => {
  const load = async spec => { const m = await import(spec); return m.chromium ? m : m.default; };
  try { return await load('playwright-core'); } catch {}
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return await load(pathToFileURL(createRequire(join(dirname(resolve(common)), 'x.js')).resolve('playwright-core')).href);
  } catch {}
  console.error('playtest: playwright-core is not installed (it is listed in package.json). Run npm install in the main checkout.');
  process.exit(1);
})();
const env = process.env;
const RESULTS = 'playtest-results';
const OLD_REF = env.PLAYTEST_OLD_REF || 'feature/core-engine';
const ICD = env.PLAYTEST_VK_ICD || '/usr/share/vulkan/icd.d/intel_icd.json';
const SOFTWARE = /swiftshader|llvmpipe|software|softpipe/i;
const BUDGET = 0.10; // NEW fails when work per frame or frame work time is more than 10% over OLD
const ROUNDS = Math.max(2, Number(env.PLAYTEST_ROUNDS) || 90); // most turns per build; each turn is FRAMES scripted frames
const FRAMES = Math.max(5, Number(env.PLAYTEST_FRAMES) || 15); // short turns: host load drifts, so old and new must meet it within a few frames of each other
const WORK_TURNS = Math.max(1, Math.round(360 / FRAMES)); // the scripted route repeats every 360 frames: the work count is the mean over exactly one route, so it does not depend on how many rounds fit
const MIN_ROUNDS = Math.min(ROUNDS, WORK_TURNS); // fewest turns per build (one whole route), kept even when the host is so busy that the run's time is used up
const MAX_MS = Number(env.PLAYTEST_MAX_MS) || 540_000; // soft limit for the whole run; the hard limit is MAX_MS + 30 s (the check allows 10 min)
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let verdictPrinted = false;
const verdict = ok => { if (verdictPrinted) return; verdictPrinted = true; (ok ? console.log : console.error)(ok ? 'PLAYTEST PASSED' : 'PLAYTEST FAILED'); };
// Every way out ends with the one verdict line: a refusal, a setup error, a signal. Only verdict(true) gives exit 0.
process.on('exit', () => { if (!verdictPrinted) { verdict(false); process.exitCode = 1; } });
const die = msg => { console.error(`playtest: ${msg}`); process.exit(1); };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const round = (v, d = 2) => +v.toFixed(d);
const pct = (a, b) => Math.round((b / a - 1) * 100);

// ---- 1. local only: refuse before anything else starts ----
for (const [name, value] of [['PLAYTEST_URL', env.PLAYTEST_URL], ['VITE_SUPABASE_URL', env.VITE_SUPABASE_URL]]) {
  if (!value) continue;
  let host = '';
  try { host = new URL(value).hostname; } catch { die(`${name} is not a web address. The playtest runs on local addresses only.`); }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) die(`${name}=${value} is not local. The playtest runs on local addresses only (127.0.0.1 or localhost).`);
}
const PROFILES = {
  laptop: { viewport: { width: 1280, height: 720 }, phone: false, quality: 'balanced' },
  phone: { viewport: { width: 390, height: 844 }, phone: true, quality: 'low' },
};
const BACKENDS = {
  webgpu: { args: ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--use-angle=vulkan'], env: { VK_ICD_FILENAMES: ICD } },
  webgl2: { args: ['--disable-features=Vulkan', '--use-angle=gl'], env: {} },
};
if (!existsSync(ICD)) die(`Intel Vulkan driver file ${ICD} not found (set PLAYTEST_VK_ICD).`);

// ---- 2. chrome, local database, two builds, two static servers ----
function findChrome() {
  for (const c of [env.PLAYTEST_CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (!c) continue;
    try { return c.startsWith('/') ? (statSync(c), c) : execFileSync('which', [c], { encoding: 'utf8' }).trim(); } catch {}
  }
  die('no Chrome found. Install google-chrome or set PLAYTEST_CHROME.');
}
const chromePath = findChrome();
let supa;
try {
  supa = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch { die('the local database is not running. Start it with: npm run play (then stop that, or leave it running).'); }
const supabaseUrl = env.VITE_SUPABASE_URL || supa.API_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || supa.PUBLISHABLE_KEY || supa.ANON_KEY;
const EMAIL = 'playtest-player@example.test';
const PASSWORD = 'Playtest-Local-1!';
const temps = []; const servers = [];

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
  const origin = new URL(supabaseUrl).origin;
  // Production CSP plus the local database address; built from the real header so it cannot drift.
  const csp = readFileSync('netlify.toml', 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1].replace('connect-src', `connect-src ${origin} ${origin.replace('http', 'ws')}`);
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      let f = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) f = join(root, 'index.html');
      const body = readFileSync(f);
      res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Content-Security-Policy': csp });
      res.end(body);
    });
    s.once('error', reject).listen(0, '127.0.0.1', () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); }); // a free port: a leftover run cannot block this one
  });
}
async function cleanup() {
  await Promise.all(servers.map(s => new Promise(r => { s.close(r); s.closeAllConnections?.(); }))).catch(() => {});
  for (const d of temps) rmSync(d, { recursive: true, force: true });
  // Every run adds rooms and saved worlds for the test player. Remove them (local container only; the account stays).
  try {
    const id = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)[1];
    const who = `(select id from auth.users where email = '${EMAIL}')`;
    execFileSync('docker', ['exec', `supabase_db_${id}`, 'psql', '-U', 'postgres', '-q', '-c',
      `delete from public.blocktopia_room_actors where user_id = ${who}; delete from public.saved_expeditions where user_id = ${who};`], { stdio: 'ignore' });
  } catch { console.error("playtest: could not remove the test player's rows from the local database"); }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => cleanup().finally(() => process.exit(130)));
// Backstop: a run that hangs (a build, a page) ends itself, so a killed parent never leaves it holding the machine.
setTimeout(() => { console.error(`playtest: the run's time limit passed (${Math.round(MAX_MS / 1000)} s)`); cleanup().finally(() => process.exit(1)); }, MAX_MS + 60_000).unref();

// Build one tree (the working tree, or a plain export of OLD_REF) into its own temp dir.
async function build(tree) {
  const dist = mkdtempSync(join(tmpdir(), 'bt-dist-')); temps.push(dist);
  await promisify(execFile)('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: tree, env: { ...env, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey } });
  return dist;
}
function exportOld() {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', `${OLD_REF}^{commit}`], { stdio: 'ignore' }); } catch { throw new Error(`PLAYTEST_OLD_REF=${OLD_REF} is not a git commit or branch here.`); }
  const dir = mkdtempSync(join(tmpdir(), 'bt-old-')); temps.push(dir);
  execFileSync('sh', ['-c', `git archive "$0" | tar -x -C "$1"`, OLD_REF, dir]);
  // OLD must run its own three (the one its lockfile pins), not NEW's: install it from the npm cache, no network.
  try { execFileSync('npm', ['ci', '--offline', '--no-audit', '--no-fund', '--silent'], { cwd: dir, stdio: 'ignore' }); }
  catch { symlinkSync(realpathSync('node_modules'), join(dir, 'node_modules')); console.log('  note: OLD could not be installed offline; it builds against the working tree\'s node_modules (its three is then NOT its own)'); }
  // Old mains have no `debug` hook in the diagnostics object; the shots need the camera, player and scene. Added to OLD's temp copy only.
  const main = join(dir, 'src/main.js'), src = readFileSync(main, 'utf8'), hook = 'window.__THREE_GAME_DIAGNOSTICS__={';
  if (!src.includes('get debug()')) {
    if (!src.includes(hook)) throw new Error(`OLD (${OLD_REF}) src/main.js has no diagnostics object to hang the camera hook on`);
    writeFileSync(main, src.replace(hook, `${hook}get debug(){return {world,player,camera:renderer.camera,scene:renderer.scene};},`));
  }
  return dir;
}

// ---- 3. in the page: virtual clock, scripted route, per-frame counts and time ----
// Runs before the game. The game's frame callback is timed with the real clock; its sim clock (performance.now) advances
// exactly 1/60 s per scripted frame, and only on frames where terrain streaming has settled, so frame N is the same on every run.
function pageHarness({ code, quality, seed }) {
  const realNow = performance.now.bind(performance);
  const realRAF = window.requestAnimationFrame.bind(window);
  const crypt = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = a => (a instanceof Uint8Array && a.length === 6 ? (a.set(code), a) : crypt(a)); // fixed room => fixed world
  try { localStorage.setItem('blocktopia-quality', quality); localStorage.setItem('blocktopia-mouse-mode', 'cursor'); } catch {} // auto quality pinned
  const getContext = HTMLCanvasElement.prototype.getContext; // which context type the game's own canvas really got
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const c = getContext.call(this, type, ...rest); if (c && this.id === 'canvas' && !window.__game) window.__game = { type, c }; return c; };
  const STEP = 1000 / 60;
  const S = window.__PT = { mode: 'free', virt: 0, useVirt: false, n: 0, stable: 0, sig: '', lastT: -1, waited: 0, unfocused: 0, turn: null, held: new Set() };
  // The first read in a frame is exactly the virtual time (the sim's dt stays identical on every run); later reads in the same frame add the
  // real time elapsed, so a loop that waits on performance.now() (a slow build) still ends.
  performance.now = () => { if (!S.useVirt) return realNow(); if (S.first) { S.first = false; S.vr = realNow(); return S.virt; } return S.virt + realNow() - S.vr; };
  // The game also reads Date.now() (day/night light, animal animation): during a turn it gives a fixed date plus the scripted time, so frame N looks the same on every run.
  const realDate = Date.now.bind(Date);
  Date.now = () => (S.useVirt ? 1.76e12 + S.virt - S.virt0 : realDate());
  const rng = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const canvas = () => document.getElementById('canvas');
  const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const mouse = (type, button, target = canvas()) => target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
  const look = (dx, dy) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
  // The route, by scripted frame number n: hold right button to look, walk forward, sweep the view, jump, break one block, place one.
  const CYCLE = 360;
  function script(n) {
    const f = n % CYCLE;
    if (n === 0) mouse('mousedown', 2);
    // walk out and back so the route stays on the loaded ground (a longer walk leaves it and the player falls into unloaded terrain)
    if (f === 0) key('keydown', 'KeyW'); else if (f === 60) key('keyup', 'KeyW'); else if (f === 180) key('keydown', 'KeyS'); else if (f === 240) key('keyup', 'KeyS');
    look(Math.round(7 * Math.sin(n / 40)), f === 100 ? 90 : f === 150 ? -90 : 0); // sweep; dip the view to the ground for the break and place
    if (f % 120 === 30) key('keydown', 'Space'); else if (f % 120 === 33) key('keyup', 'Space');
    if (f === 110) { mouse('mouseup', 2); mouse('mousedown', 0); } // break (left button held)
    if (f === 140) { mouse('mouseup', 0); mouse('mousedown', 2); }  // back to look-drag
    if (f === 155) { mouse('mouseup', 2); mouse('mousedown', 2); mouse('mouseup', 2); mouse('mousedown', 2); } // short right press places a block
  }
  const diag = () => window.__THREE_GAME_DIAGNOSTICS__;
  function frameStart() { // once per animation frame, before the callbacks run
    const d = diag(); if (!d) return false;
    d.renderer.autoReset = false; // water renders more than once per frame: count them all, reset by hand
    const w = d.world; const sig = `${w.chunks},${w.meshes}`;
    if (w.pending === 0 && sig === S.sig) S.stable++; else { S.stable = 0; S.sig = sig; }
    if (S.stable < 8 && S.waited++ < 1500) return false; // terrain still streaming: let the game run, freeze the clock
    S.virt += STEP;
    if (S.n === 0 || S.n % FRAMES_PER_TURN === 0) Math.random = rng(seed + S.n); // same random numbers in every build at the start of each turn
    script(S.n++);
    return true;
  }
  let FRAMES_PER_TURN = 90;
  // GPU time. A build with its own timestamp queries (diag.gpuMs, the WebGPU renderer on either backend) is read as it is. A build without
  // them (the old WebGL renderer) gets one EXT_disjoint_timer_query_webgl2 query round each game frame, begun before and ended after the timed
  // span, so the CPU numbers are not touched. Both sum the GPU time of every pass in the turn; the node side divides by game frames.
  S.qs = [];
  S.gpuOld = async () => {
    const { gl, ext } = S; let ns = 0, bad = false;
    for (const q of S.qs) {
      const end = realNow() + 3000;
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && realNow() < end) await new Promise(r => setTimeout(r, 5));
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) ns += gl.getQueryParameter(q, gl.QUERY_RESULT); else bad = true;
      gl.deleteQuery(q);
    }
    S.qs = [];
    return bad || gl.getParameter(ext.GPU_DISJOINT_EXT) ? null : ns / 1e6;
  };
  const run = (cb, t, measuring) => {
    const info = diag().renderer, T = S.turn;
    let q = null;
    if (T) { T.frames++; if (S.ext && !diag().gpuMs) { q = S.gl.createQuery(); S.gl.beginQuery(S.ext.TIME_ELAPSED_EXT, q); } }
    S.first = true; // each callback's first clock read is the exact frame time (three's own frame callback runs before the game's)
    try {
      if (!measuring) return void cb(t);
      info.reset(); const t0 = realNow(); cb(t); const ms = realNow() - t0;
      const draws = diag().gpuMs ? info.render.drawCalls : info.render.calls; // node renderer: render.calls counts render() calls and is never reset
      if (draws > 0 && T && T.ms.length < T.want) { T.ms.push(ms); T.calls.push(draws); T.tris.push(info.render.triangles); if (!document.hasFocus() || document.visibilityState !== 'visible') S.unfocused++; }
    } finally { if (q) { S.gl.endQuery(S.ext.TIME_ELAPSED_EXT); S.qs.push(q); } }
  };
  window.requestAnimationFrame = cb => realRAF(function tick(t) {
    if (S.mode === 'free') return cb(t);
    if (S.mode === 'paused' || !diag()) return void realRAF(tick); // not this build's turn: skip the game's callback, keep its loop alive
    if (t !== S.lastT) { S.lastT = t; S.first = true; S.settled = frameStart(); }
    if (S.turn && S.turn.ms.length >= S.turn.want) { S.turn.done?.(); S.turn = null; S.mode = 'paused'; S.useVirt = false; return void realRAF(tick); }
    run(cb, t, S.settled);
  });
  S.runTurn = want => new Promise(done => { FRAMES_PER_TURN = want; S.qs = []; S.turn = { want, ms: [], calls: [], tris: [], frames: 0, done: () => done({ ms: S.last.ms, calls: S.last.calls, tris: S.last.tris, frames: S.last.frames, unfocused: S.unfocused }) }; S.last = S.turn; if (!S.virt) S.virt = S.virt0 = realNow(); S.useVirt = true; S.mode = 'measure'; });

  // ---- colour shots: same camera in every build; the game runs on its real clock for these (S.mode 'free') ----
  const raf = n => new Promise(r => { const go = () => n-- > 0 ? realRAF(go) : r(); go(); });
  const D = () => diag().debug;
  const release = () => { for (const c of ['KeyW', 'KeyS', 'Space']) key('keyup', c); mouse('mouseup', 0); mouse('mouseup', 2); };
  const place = async (x, z, yaw, pitch) => { // stand on the ground at (x, z), looking yaw/pitch, and let the player land and the view settle
    S.mode = 'free'; S.useVirt = false; release();
    const { world, player } = D();
    player.position.set(x, world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1.2, z); player._yaw = yaw; player._pitch = pitch;
    await raf(90);
  };
  const fragments = () => D().scene.children.filter(m => m.geometry?.parameters?.width === 0.075).length;
  S.shot = async kind => {
    const { world } = D();
    if (kind === 'cottage') return place(18.5, 5.5, 0, 0); // hearthwood cottage, seen from the south
    if (kind === 'trunk') { // the big tree nearest the spawn, from 3 m south
      let best = null;
      for (const c of world.chunks.values()) for (const t of c.trees ?? []) { const d = Math.hypot(t.x - 12, t.z - 12) - (t.width > 1 ? 8 : 0); if (!best || d < best.d) best = { t, d }; }
      return place(best.t.x + best.t.width / 2, best.t.z + best.t.width + 2.5, 0, 0);
    }
    // debris: dig a 2-deep pit (the wall is then at eye height and half a metre away), break the wall block, freeze 2 frames after the pieces appear
    const { player } = D(), x = 12.5, z = 12.5;
    await place(x, z, 0, -Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const y0 = player.position.y; mouse('mousedown', 0);
      for (let k = 0; k < 300 && player.position.y > y0 - 0.8; k++) await raf(1);
      mouse('mouseup', 0); await raf(60); // fall, settle, the first pieces expire
    }
    player._pitch = 0; player._yaw = 0; await raf(10);
    const before = fragments(); mouse('mousedown', 0);
    for (let k = 0; k < 120 && fragments() <= before; k++) await raf(1);
    await raf(2); S.mode = 'paused'; mouse('mouseup', 0);
    return fragments() - before;
  };
}

// ---- 4. one build in one browser context: sign in, start a world, then wait for turns ----
async function startSession(browser, name, url, profile, quality, code, backendName, videoDir) {
  const phone = profile.phone;
  const ctx = await browser.newContext({ viewport: profile.viewport, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1, recordVideo: { dir: videoDir, size: profile.viewport } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(120000); // setup steps wait on a loaded host; the run's own time limit is the real bound
  const errors = [];
  p.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  if (phone) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.addInitScript(pageHarness, { code, quality, seed: 1013 });
  await p.goto(`${url}/?diagnostics`, { waitUntil: 'load' });
  await p.waitForSelector('#account-form', { timeout: 60000 });
  await p.fill('#account-email', EMAIL); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
  if (!await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 12000 }).catch(() => null)) {
    await p.click('#account-switch'); await p.fill('#account-email', EMAIL); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
    await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 60000 });
  }
  await p.click('#create-room');
  await p.waitForFunction(() => !document.getElementById('click-to-play').disabled, null, { timeout: 120000 });
  if (phone) await p.tap('#click-to-play'); else await p.click('#click-to-play');
  await p.waitForSelector('#play-gate', { state: 'hidden', timeout: 15000 }).catch(() => { throw new Error(`${name}: the play gate did not close: the game never started`); });
  await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.world?.position, null, { timeout: 60000 });
  const gpu = await p.evaluate(async () => {
    const g = window.__game; const gl = g?.type.startsWith('webgl') ? g.c : null; const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    let adapter = null;
    try { const a = await navigator.gpu?.requestAdapter(); if (a) adapter = { ...(a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description } : {}), isFallbackAdapter: !!a.isFallbackAdapter }; } catch {}
    return { adapter, gameContext: g?.type ?? null, gameRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
  });
  if (SOFTWARE.test(JSON.stringify(gpu)) || gpu.adapter?.isFallbackAdapter) throw new Error(`software GPU in use: ${JSON.stringify(gpu)}`);
  if (backendName === 'webgpu' && !/intel/i.test(gpu.adapter?.vendor ?? '')) throw new Error(`WebGPU did not bind the Intel adapter: ${JSON.stringify(gpu)}`);
  if (!gpu.gameContext) throw new Error('the game never created a rendering context on its canvas');
  // The game's own engine and backend. A build that reports gpuMs times itself (three's timestamp queries); an older one gets harness-side WebGL timer queries.
  const engine = await p.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__, g = window.__game, S = window.__PT;
    const native = typeof d.gpuMs === 'function';
    const backend = d.backend ?? (g.type === 'webgl2' ? 'webgl2' : g.type);
    if (!native) { // shortcut: harness timer queries wrap each whole frame callback, not only the draw calls; fine for a before/after on the same page
      if (g.type !== 'webgl2') return { error: `no GPU timer for a ${g.type} context` };
      S.gl = g.c; S.ext = g.c.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!S.ext) return { error: 'EXT_disjoint_timer_query_webgl2 is not available' };
    }
    return { three: String(window.__THREE__), backend, native };
  });
  if (engine.error) throw new Error(`${name}: ${engine.error}`);
  if (engine.native && engine.backend !== backendName) throw new Error(`${name}: the ${backendName} profile ran the game on ${engine.backend}`);
  if (!engine.native && backendName === 'webgpu') engine.backend = 'webgl2'; // an old WebGL-only build has nothing else to give on the webgpu profile
  const seed = await p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.world.seed);
  await p.evaluate(() => { window.__PT.mode = 'paused'; }); // from here the page only runs during its own turn
  return { name, ctx, p, gpu, engine, seed, errors, video: p.video() };
}

// ---- 5. one profile/backend: both builds alive, alternate turns ----
async function playCombo(profileName, backendName, urls, codes, plan) {
  const t0 = Date.now();
  const profile = PROFILES[profileName]; const backend = BACKENDS[backendName];
  const videoDir = mkdtempSync(join(tmpdir(), 'bt-video-')); temps.push(videoDir);
  const run = { profile: profileName, backend: backendName, viewport: profile.viewport, cpuSlowdown: profile.phone ? 4 : 1, touch: profile.phone, quality: profile.quality };
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, env: { ...env, ...backend.env },
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion', ...backend.args] });
  try {
    const [o, n] = await Promise.all([
      startSession(browser, 'old', urls.old, profile, profile.quality, codes.old, backendName, videoDir),
      startSession(browser, 'new', urls.new, profile, profile.quality, codes.new, backendName, videoDir)]);
    run.gpu = n.gpu; run.seeds = { old: o.seed, new: n.seed };
    // What each build really ran on: the engine revision and backend it reported, and the context type its canvas got.
    run.engine = { old: { three: o.engine.three, backend: o.engine.backend }, new: { three: n.engine.three, backend: n.engine.backend } };
    run.gameApi = { old: o.gpu.gameContext, new: n.gpu.gameContext };
    run.startup = await n.p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.startup); // shader build + first render before the loop, NEW only
    // A WebGL2 context must sit on the path the profile asked for (ANGLE over Vulkan or over OpenGL ES); a WebGPU context has no such string.
    for (const s of [o, n]) if (s.gpu.gameRenderer && !new RegExp(backendName === 'webgpu' ? 'vulkan' : 'opengl', 'i').test(s.gpu.gameRenderer) && s.engine.native)
      throw new Error(`${s.name}: the ${backendName} profile did not get its graphics path: the game's renderer is ${s.gpu.gameRenderer}`);
    const turns = { old: [], new: [] };
    // Run length does not depend on host load: this run's share of the time left (minus the setup the later runs still need) sets how many
    // rounds it plays, from MIN_ROUNDS up to ROUNDS. A turn is only cut off at the hard limit, never for being slow.
    const setupMs = Date.now() - t0;
    const share = Math.max(20_000, (T0 + MAX_MS - Date.now() - (plan.left - 1) * Math.max(setupMs, plan.setupMs)) / plan.left);
    const stopAt = Date.now() + share; const hardAt = T0 + MAX_MS + 30_000;
    const guard = async s => {
      const ms = Math.max(5000, hardAt - Date.now()), diagGpu = () => window.__THREE_GAME_DIAGNOSTICS__.gpuMs();
      if (s.engine.native) await s.p.evaluate(diagGpu); // flush: only this turn's passes are read back afterwards
      const x = await Promise.race([s.p.evaluate(f => window.__PT.runTurn(f), FRAMES), sleep(ms).then(() => { throw new Error(`${s.name} build: the run's time limit passed (${Math.round(MAX_MS / 1000)} s) before a ${FRAMES}-frame turn ended`); })]);
      const total = await s.p.evaluate(s.engine.native ? diagGpu : () => window.__PT.gpuOld()); // GPU ms of every pass in the turn, per game frame below
      x.gpuMs = total > 0 && x.frames ? total / x.frames : null;
      return x;
    };
    let rounds = 0;
    for (; rounds < ROUNDS && (rounds < MIN_ROUNDS || Date.now() < stopAt); rounds++) for (const s of [o, n]) turns[s.name].push(await guard(s)); // old, new, old, new ...
    run.setupMs = setupMs;
    // Both builds run the same scripted frames, so frame k of OLD and frame k of NEW do the same work. Host preemption only adds
    // time, and short alternating turns give both builds the same load; the median over every frame drops the spikes.
    const side = t => ({
      calls: mean(t.slice(0, WORK_TURNS).flatMap(x => x.calls)), triangles: mean(t.slice(0, WORK_TURNS).flatMap(x => x.tris)), frames: t.reduce((a, x) => a + x.ms.length, 0),
      ms: median(t.flatMap(x => x.ms)), p25: quantile(t.flatMap(x => x.ms), 0.25),
    });
    const so = side(turns.old), sn = side(turns.new);
    run.work = { old: { calls: so.calls, triangles: so.triangles }, new: { calls: sn.calls, triangles: sn.triangles } };
    run.race = { oldMs: round(so.ms, 3), newMs: round(sn.ms, 3), rounds, framesPerTurn: FRAMES,
      turnCalls: { old: turns.old.map(x => mean(x.calls)), new: turns.new.map(x => mean(x.calls)) }, oldP25Ms: round(so.p25, 3), newP25Ms: round(sn.p25, 3),
      turnMs: { old: turns.old.map(x => round(median(x.ms), 2)), new: turns.new.map(x => round(median(x.ms), 2)) },
      pairRatioP50: round(median(turns.old.map((x, i) => median(x.ms.map((m, k) => turns.new[i].ms[k] / m)))), 3) };
    // GPU time per game frame. A turn the timer could not read (a disjoint query, an empty pool) is left out, not counted as zero.
    const gpu = t => t.map(x => x.gpuMs).filter(g => g > 0);
    run.race.oldGpuMs = round(median(gpu(turns.old)), 3); run.race.newGpuMs = round(median(gpu(turns.new)), 3);
    run.race.gpuTurns = { old: gpu(turns.old).map(g => round(g, 3)), new: gpu(turns.new).map(g => round(g, 3)) };
    run.race.gpuPairRatioP50 = round(median(turns.old.flatMap((x, i) => x.gpuMs > 0 && turns.new[i].gpuMs > 0 ? [turns.new[i].gpuMs / x.gpuMs] : [])), 3);
    run.race.gpuMethod = { old: o.engine.native ? 'three timestamp queries' : 'EXT_disjoint_timer_query_webgl2 around each frame', new: n.engine.native ? 'three timestamp queries' : 'EXT_disjoint_timer_query_webgl2 around each frame' };
    // Colour shots: the same camera in both builds; cottage walls and roof, a tree trunk, and the pieces of a block just broken.
    mkdirSync(`${RESULTS}/shots`, { recursive: true });
    run.shots = { old: {}, new: {} };
    for (const s of [o, n]) for (const kind of ['cottage', 'trunk', 'debris']) {
      const path = `${RESULTS}/shots/${profileName}-${backendName}-${s.name}-${kind}.png`;
      const info = await s.p.evaluate(k => window.__PT.shot(k), kind);
      if (kind === 'debris' && !(info > 0)) throw new Error(`${s.name} build: breaking a block made no debris to photograph`);
      await s.p.screenshot({ path }); run.shots[s.name][kind] = path;
    }
    run.unfocusedFrames = (await o.p.evaluate(() => window.__PT.unfocused)) + (await n.p.evaluate(() => window.__PT.unfocused));
    run.errors = [...o.errors, ...n.errors]; run.pageErrors = { old: o.errors, new: n.errors };
    mkdirSync(`${RESULTS}/videos`, { recursive: true });
    await Promise.all([o, n].map(s => s.ctx.close()));
    run.video = `${RESULTS}/videos/${profileName}-${backendName}.webm`;
    // Videos are evidence, not the verdict: a copy that fails (full disk, quota) is recorded and does not fail a good build.
    try { await n.video.saveAs(run.video); await o.video.saveAs(`${RESULTS}/videos/${profileName}-${backendName}-old.webm`); } // copies; /tmp and the project can be different disks
    catch (error) { run.videoError = String(error.message || error).split('\n')[0].slice(0, 200); run.video = null; }
  } catch (error) {
    run.failed = String(error.message || error).split('\n')[0].slice(0, 300);
  } finally {
    await browser.close().catch(() => {});
  }
  return run;
}

// Two room codes that make the same world seed, so OLD and NEW walk the same terrain without being in the same room.
async function sameSeedCodes() {
  const { roomSeed, ROOM_ALPHABET } = await import(pathToFileURL(join(ROOT, 'src/network/protocol.js')));
  const seen = new Map(); let s = 1;
  for (let i = 0; i < 2_000_000; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const bytes = [0, 1, 2, 3, 4, 5].map(k => ((s >>> (k * 5)) ^ (i >>> (k * 3))) & 31);
    const seed = roomSeed(bytes.map(b => ROOM_ALPHABET[b]).join(''));
    const other = seen.get(seed);
    if (other && other.join() !== bytes.join()) return { old: other, new: bytes };
    seen.set(seed, bytes);
  }
  return { old: [3, 7, 11, 13, 17, 19], new: [3, 7, 11, 13, 17, 19] };
}

// ---- 6. main ----
let exitCode = 0;
try {
  console.log(`Building OLD (${OLD_REF}) and NEW (working tree) against the local database…`);
  const oldTree = exportOld();
  const [oldDist, newDist] = await Promise.all([build(oldTree), build(ROOT)]);
  const urls = { new: await serve(newDist), old: await serve(oldDist) };
  const codes = await sameSeedCodes();
  rmSync(RESULTS, { recursive: true, force: true });
  const runs = [];
  const combos = Object.keys(PROFILES).flatMap(p => Object.keys(BACKENDS).map(b => [p, b])).filter(([p, b]) => !env.PLAYTEST_ONLY || env.PLAYTEST_ONLY === `${p}/${b}`); // filter is for dev, e.g. phone/webgl2
  let setupMs = 40_000; // guess until the first run has measured its own setup
  console.log('  note: "webgpu" = Chrome WebGPU on the Intel GPU (Vulkan); "webgl2" = WebGL2 over OpenGL ES. A build that cannot use WebGPU runs WebGL2 on both. OLD gets its GPU time from WebGL timer queries around each frame, NEW from three\'s timestamp queries; OLD\'s temp copy also gets a diagnostics-only camera hook.');
  for (const [profile, backend] of combos) {
    const t0 = Date.now();
    const run = await playCombo(profile, backend, urls, codes, { left: combos.length - runs.length, setupMs });
    if (run.setupMs) setupMs = Math.max(setupMs, run.setupMs);
    runs.push(run);
    console.log(run.failed ? `  ${profile}/${backend} FAILED: ${run.failed}` : `  ${profile}/${backend} (${Math.round((Date.now() - t0) / 1000)} s): draw calls ${run.work.old.calls}/${run.work.new.calls}, triangles ${run.work.old.triangles}/${run.work.new.triangles}, frame work ${run.race.oldMs}/${run.race.newMs} ms, GPU ${run.race.oldGpuMs}/${run.race.newGpuMs} ms (old/new), ${run.startup ? `shader build ${run.startup.compileMs} ms + first render ${run.startup.firstRenderMs} ms before the first frame, ` : ''}${run.race.rounds} rounds${run.videoError ? ` (video not saved: ${run.videoError})` : ''}`);
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/latest.json`, JSON.stringify({ createdAt: new Date().toISOString(), oldRef: OLD_REF, runs }, null, 2));
  const problems = [];
  for (const r of runs) {
    const key = `${r.profile}/${r.backend}`;
    if (r.failed) { problems.push(`${key}: run failed: ${r.failed}`); continue; }
    if (r.unfocusedFrames > 0) problems.push(`${key}: ${r.unfocusedFrames} unfocused frames, numbers are not trustworthy`);
    if (r.seeds.old !== r.seeds.new) console.log(`  note: ${key} OLD and NEW built different worlds (seed ${r.seeds.old} vs ${r.seeds.new}); work counts compare different terrain`);
    for (const [label, a, b] of [['draw calls per frame', r.work.old.calls, r.work.new.calls], ['triangles per frame', r.work.old.triangles, r.work.new.triangles]])
      if (b > a * (1 + BUDGET)) problems.push(`${key}: ${label} ${a} -> ${b} (+${pct(a, b)}%)`);
    // Host load bursts hit one side's median (identical builds showed +30% there with p25 +3% and paired ratio 1.04), so a slowdown counts only when the median, the lower quartile and the paired per-frame ratio all show it.
    // GPU time: the same rule on the GPU clock, so a slowdown that costs the GPU and not the CPU (a higher pixel ratio) is caught and named.
    if (!(r.race.oldGpuMs > 0 && r.race.newGpuMs > 0)) problems.push(`${key}: GPU time could not be measured (old ${r.race.oldGpuMs}, new ${r.race.newGpuMs})`);
    else if (r.race.newGpuMs > r.race.oldGpuMs * (1 + BUDGET) && r.race.gpuPairRatioP50 > 1 + BUDGET) problems.push(`${key}: GPU time ${r.race.oldGpuMs} ms -> ${r.race.newGpuMs} ms (+${pct(r.race.oldGpuMs, r.race.newGpuMs)}%)`);
    if (r.pageErrors.new.length) problems.push(`${key}: page errors in NEW: ${r.pageErrors.new.slice(0, 3).join(' | ')}`);
    if (r.race.newMs > r.race.oldMs * (1 + BUDGET) && r.race.newP25Ms > r.race.oldP25Ms * (1 + BUDGET) && r.race.pairRatioP50 > 1 + BUDGET) problems.push(`${key}: frame work ${r.race.oldMs} ms -> ${r.race.newMs} ms (+${pct(r.race.oldMs, r.race.newMs)}%)`);
  }
  if (problems.length) { console.error(problems.join('\n')); verdict(false); exitCode = 1; }
  else verdict(true);
} catch (error) {
  console.error(`playtest: ${error.message}`);
  verdict(false);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
