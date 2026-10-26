// Local-only playtest: builds the game, serves it, plays a fixed route on laptop and phone profiles
// over real Intel WebGPU and forced WebGL2, writes playtest-results/latest.json, compares to a baseline.
// Usage: npm run playtest [-- --save-baseline]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const env = process.env;
const PORT = 4173;
const RESULTS = 'playtest-results';
const BASELINE = env.PLAYTEST_BASELINE || 'tests/perf/baseline.json';
const ICD = env.PLAYTEST_VK_ICD || '/usr/share/vulkan/icd.d/intel_icd.json';
const SOFTWARE = /swiftshader|llvmpipe|software|softpipe/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = msg => { console.error(`playtest: ${msg}`); process.exit(1); };

// ---- 1. local only: refuse before anything else starts ----
for (const [name, value] of [['PLAYTEST_URL', env.PLAYTEST_URL], ['VITE_SUPABASE_URL', env.VITE_SUPABASE_URL]]) {
  if (!value) continue;
  let host = '';
  try { host = new URL(value).hostname; } catch { die(`${name} is not a web address. The playtest runs on local addresses only.`); }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) die(`${name}=${value} is not local. The playtest runs on local addresses only (127.0.0.1 or localhost).`);
}
const PROFILES = {
  laptop: { viewport: { width: 1280, height: 720 }, phone: false },
  phone: { viewport: { width: 390, height: 844 }, phone: true },
};
const BACKENDS = {
  webgpu: { args: ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--use-angle=vulkan'], env: { VK_ICD_FILENAMES: ICD } },
  webgl2: { args: ['--disable-features=Vulkan', '--use-angle=gl'], env: {} },
};
const savingBaseline = process.argv.includes('--save-baseline');
if (!savingBaseline && !existsSync(BASELINE)) die(`baseline ${BASELINE} not found. Create one with: npm run playtest -- --save-baseline`);
if (!existsSync(ICD)) die(`Intel Vulkan driver file ${ICD} not found (set PLAYTEST_VK_ICD).`);

// ---- 2. chrome, local database, build, static server ----
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
const externalUrl = env.PLAYTEST_URL;
const BASE = externalUrl || `http://127.0.0.1:${PORT}`;
let server; let dist;
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
    s.once('error', reject).listen(PORT, '127.0.0.1', () => resolve(s));
  });
}
async function cleanup() {
  await new Promise(r => (server ? server.close(r) : r())).catch(() => {});
  server?.closeAllConnections?.();
  if (dist) rmSync(dist, { recursive: true, force: true });
  // Every run adds rooms and saved worlds for the test player. Remove them (local container only; the account stays).
  if (!externalUrl) try {
    const id = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)[1];
    const who = `(select id from auth.users where email = '${EMAIL}')`;
    execFileSync('docker', ['exec', `supabase_db_${id}`, 'psql', '-U', 'postgres', '-q', '-c',
      `delete from public.blocktopia_room_actors where user_id = ${who}; delete from public.saved_expeditions where user_id = ${who};`], { stdio: 'ignore' });
  } catch { console.error("playtest: could not remove the test player's rows from the local database"); }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().finally(() => process.exit(130)));

// ---- 3. one run: sign in, play the fixed route, collect numbers ----
const pct = (a, q) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(2) : null);
const PASSWORD = 'Playtest-Local-1!';
const EMAIL = 'playtest-player@example.test';

async function playRoute(profileName, backendName) {
  const profile = PROFILES[profileName]; const backend = BACKENDS[backendName];
  const phone = profile.phone;
  const videoDir = mkdtempSync(join(tmpdir(), 'bt-video-'));
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, env: { ...env, ...backend.env },
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion', ...backend.args] });
  const run = { profile: profileName, backend: backendName, viewport: profile.viewport, cpuSlowdown: phone ? 4 : 1, touch: phone, errors: [], phases: {} };
  try {
    const ctx = await browser.newContext({ viewport: profile.viewport, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1, recordVideo: { dir: videoDir, size: profile.viewport } });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    p.on('pageerror', e => run.errors.push(e.message.slice(0, 200)));
    await p.addInitScript(() => {
      // Fixed room code => fixed world seed, so every run walks the same terrain.
      const real = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = a => (a instanceof Uint8Array && a.length === 6 ? (a.set([3, 7, 11, 13, 17, 19]), a) : real(a));
      // Remember which context type the game's own canvas really got (webgl2, webgl or webgpu).
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const c = getContext.call(this, type, ...rest); if (c && this.id === 'canvas' && !window.__game) window.__game = { type, c }; return c; };
      const S = window.__S = { unfocused: 0, dts: [], last: 0, arm: null, lat: [] };
      const tick = t => {
        if (!document.hasFocus() || document.visibilityState !== 'visible') { S.unfocused++; S.last = 0; } else if (S.last) S.dts.push(t - S.last);
        S.last = t;
        const w = window.__THREE_GAME_DIAGNOSTICS__?.world;
        if (S.arm?.t0 && w) {
          const d = Math.hypot(w.position[0] - S.arm.p[0], w.position[2] - S.arm.p[2]) + Math.abs(w.position[1] - S.arm.p[1]);
          if (d > 0.02) { S.lat.push(performance.now() - S.arm.t0); S.arm = null; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const mark = e => { if (S.arm && !S.arm.t0) S.arm.t0 = e.timeStamp; };
      addEventListener('keydown', mark, true); addEventListener('touchstart', mark, true);
    });

    // ---- input helpers (keyboard + mouse on laptop; CDP touch on phone) ----
    const live = new Map();
    const tsend = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...live].map(([id, [x, y]]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
    const tDown = (id, x, y) => { live.set(id, [x, y]); return tsend('touchStart'); };
    const tMove = (id, x, y) => { live.set(id, [x, y]); return tsend('touchMove'); };
    // touchEnd lists the points being released (not the ones that stay down), so a held joystick survives a look swipe
    const tUp = id => { const [x, y] = live.get(id); live.delete(id); return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id, radiusX: 8, radiusY: 8, force: 1 }] }); };
    const tTap = async (id, x, y) => { await tDown(id, x, y); await sleep(60); await tUp(id); };
    const center = id => p.evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, id);
    const pos = () => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.world?.position);
    let joy = null;
    const moveStart = async (fx = 0, fz = -1) => {
      if (!phone) { for (const [k, on] of [['KeyW', fz < 0], ['KeyS', fz > 0], ['KeyA', fx < 0], ['KeyD', fx > 0]]) if (on) await p.keyboard.down(k); return; }
      joy = await center('joystick-zone'); await tDown(1, ...joy); await tMove(1, joy[0] + fx * 38, joy[1] + fz * 38);
    };
    const moveStop = async () => { if (!phone) { for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) await p.keyboard.up(k); } else if (joy) { await tUp(1); joy = null; } };
    const walk = async (ms, fx = 0, fz = -1) => { await moveStart(fx, fz); await sleep(ms); await moveStop(); await sleep(150); };
    const jump = async () => { if (!phone) { await p.keyboard.down('Space'); await sleep(80); await p.keyboard.up('Space'); } else await tTap(4, ...(await center('btn-jump'))); };
    const PX_PER_RAD = phone ? 250 : 500;
    let lookPt = null;
    const look = async (dx, dy = 0) => {
      if (!phone) { await p.evaluate(([x, y]) => { for (let i = 0; i < 6; i++) document.dispatchEvent(new MouseEvent('mousemove', { movementX: x / 6, movementY: y / 6, bubbles: true })); }, [dx, dy]); return; }
      lookPt ||= await p.evaluate(() => { const ok = (x, y) => document.elementFromPoint(x, y)?.id === 'canvas'; for (const fy of [.55, .5, .6, .45, .65, .4]) for (const fx of [.5, .6, .45, .7, .8]) { const x = innerWidth * fx, y = innerHeight * fy; if ([[-60, -60], [60, 60], [-60, 60], [60, -60], [0, 0]].every(([dx, dy]) => ok(x + dx, y + dy))) return [x, y]; } return [innerWidth * .5, innerHeight * .55]; }); // a spot whose whole swipe stays on the canvas, clear of HUD buttons
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 90));
      for (let k = 0; k < n; k++) {
        const sx = dx / n, sy = dy / n, x0 = lookPt[0] - sx / 2, y0 = lookPt[1] - sy / 2;
        await tDown(7, x0, y0); for (let i = 1; i <= 4; i++) await tMove(7, x0 + sx * i / 4, y0 + sy * i / 4); await tUp(7);
      }
    };
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    let yawSign = 1;
    async function goto(tx, tz, maxMs, stopDist) {
      let prev = await pos(); let lastErr = null; const t0 = Date.now(); let reached = false;
      await moveStart();
      while (Date.now() - t0 < maxMs) {
        await sleep(500); const q = await pos();
        if (Math.hypot(tx - q[0], tz - q[2]) < stopDist) { reached = true; break; }
        const vx = q[0] - prev[0], vz = q[2] - prev[2]; prev = q;
        if (Math.hypot(vx, vz) < 0.6) { await look((lastErr ?? 1) > 0 ? PX_PER_RAD : -PX_PER_RAD); await jump(); lastErr = null; continue; } // stuck: turn and hop
        const e = wrap(Math.atan2(tz - q[2], tx - q[0]) - Math.atan2(vz, vx));
        if (lastErr !== null && Math.abs(e) > Math.abs(lastErr) + 0.1) yawSign = -yawSign;
        if (Math.abs(e) > 0.12) { await look(yawSign * e * PX_PER_RAD * 0.9); lastErr = e; } else lastErr = null;
      }
      await moveStop(); const q = await pos();
      return { reached, distLeft: +Math.hypot(tx - q[0], tz - q[2]).toFixed(1) };
    }
    const phase = async (name, fn) => {
      await p.evaluate(() => { __S.dts = []; __S.last = 0; });
      const extra = (await fn()) || {};
      const dts = await p.evaluate(() => __S.dts.splice(0));
      run.phases[name] = { frames: dts.length, p50: pct(dts, .5), p95: pct(dts, .95), ...extra, world: await p.evaluate(() => { const w = __THREE_GAME_DIAGNOSTICS__.world; return { chunks: w.chunks, meshes: w.meshes, pending: w.pending }; }), at: (await pos()).map(v => +v.toFixed(1)) };
      allFrames.push(...dts);
    };
    const allFrames = [];

    // ---- sign in (create the local test player on first use) and start a world ----
    await p.goto(`${BASE}/?diagnostics`, { waitUntil: 'load' });
    await p.waitForSelector('#account-form', { timeout: 30000 });
    await p.fill('#account-email', EMAIL); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
    if (!await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 8000 }).catch(() => null)) {
      await p.click('#account-switch'); await p.fill('#account-email', EMAIL); await p.fill('#account-password', PASSWORD); await p.click('#account-submit');
      await p.waitForSelector('#room-lobby:not([hidden])', { timeout: 30000 });
    }
    await p.click('#create-room');
    await p.waitForFunction(() => !document.getElementById('click-to-play').disabled, null, { timeout: 120000 });
    if (phone) await p.tap('#click-to-play'); else await p.click('#click-to-play');
    // The gate must close, or every number below would measure the menu instead of the game.
    await p.waitForSelector('#play-gate', { state: 'hidden', timeout: 10000 }).catch(() => { throw new Error('the play gate did not close: the game never started'); });
    await p.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.world?.position, null, { timeout: 30000 });
    await sleep(4000); // let the first chunks mesh before measuring

    // ---- GPU identity: fail instead of measuring a software renderer ----
    run.gpu = await p.evaluate(async () => {
      const g = window.__game; const gl = g?.type.startsWith('webgl') ? g.c : null; const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      let adapter = null;
      try { const a = await navigator.gpu?.requestAdapter(); if (a) adapter = { ...(a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description } : {}), isFallbackAdapter: !!a.isFallbackAdapter }; } catch {}
      return { adapter, gameContext: g?.type ?? null, gameRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
    });
    if (SOFTWARE.test(JSON.stringify(run.gpu)) || run.gpu.adapter?.isFallbackAdapter) throw new Error(`software GPU in use: ${JSON.stringify(run.gpu)}`);
    if (backendName === 'webgpu' && !/intel/i.test(run.gpu.adapter?.vendor ?? '')) throw new Error(`WebGPU did not bind the Intel adapter: ${JSON.stringify(run.gpu)}`);
    if (!run.gpu.gameContext) throw new Error('the game never created a rendering context on its canvas');
    if (backendName === 'webgl2' && run.gpu.gameContext !== 'webgl2') throw new Error(`forced WebGL2 profile, but the game rendered with ${run.gpu.gameContext}`);

    // ---- the fixed route: look, walk, break, place, water ----
    await phase('look', async () => { await look(PX_PER_RAD); await sleep(300); await look(-PX_PER_RAD); await sleep(300); });
    await phase('walk', async () => {
      const lat = [];
      for (let i = 0; i < 4; i++) {
        const a = await pos(); await p.evaluate(a => { __S.arm = { p: a, t0: 0 }; __S.lat = []; }, a);
        await moveStart(); await sleep(700); await moveStop(); lat.push(await p.evaluate(() => __S.lat[0] ?? null)); await sleep(300);
      }
      await walk(4000);
      run.inputDelays = lat.filter(x => x != null);
    });
    const edits = () => p.evaluate(() => JSON.stringify(__THREE_GAME_DIAGNOSTICS__.world.edits));
    // wait for terrain streaming to finish, or a break/place aims at a world that is not there yet
    await p.waitForFunction(() => { const w = __THREE_GAME_DIAGNOSTICS__.world; return !w.pending; }, null, { timeout: 60000 }).catch(() => { run.note = 'terrain still streaming at break'; });
    await look(0, PX_PER_RAD * .8); await sleep(300); // look down at the ground
    await phase('break', async () => {
      const before = await edits();
      if (!phone) { await p.mouse.down(); await sleep(900); await p.mouse.up(); } else { const [x, y] = await center('btn-break'); await tDown(3, x, y); await sleep(900); await tUp(3); }
      await sleep(400); return { changed: (await edits()) !== before };
    });
    await phase('place', async () => {
      const before = await edits();
      if (!phone) await p.mouse.click(profile.viewport.width / 2, profile.viewport.height / 2, { button: 'right' }); else await tTap(6, ...(await center('btn-place')));
      await sleep(500); return { changed: (await edits()) !== before };
    });
    await look(0, -PX_PER_RAD * .8);
    await phase('water', async () => {
      const waters = await p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.waters);
      if (!waters?.length) return { reached: false, note: 'no water near spawn' };
      return goto(waters[0][0], waters[0][2], 45000, 1.5);
    });

    const frames = await p.evaluate(() => ({ unfocused: __S.unfocused }));
    run.unfocusedFrames = frames.unfocused;
    run.frameMs = { p50: pct(allFrames, .5), p95: pct(allFrames, .95), p99: pct(allFrames, .99), mean: +(allFrames.reduce((a, b) => a + b, 0) / allFrames.length).toFixed(2) };
    run.frames = allFrames.length;
    run.inputDelayMs = pct(run.inputDelays, .5);
    if (run.errors.length) run.note = 'page errors during the run';
    const video = p.video();
    await ctx.close();
    mkdirSync(`${RESULTS}/videos`, { recursive: true });
    run.video = `${RESULTS}/videos/${profileName}-${backendName}.webm`;
    await video.saveAs(run.video); // copies; /tmp and the project can be different disks
  } catch (error) {
    run.failed = String(error.message || error).split('\n')[0].slice(0, 300);
  } finally {
    await browser.close().catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
  }
  return run;
}

// ---- 4. main ----
// The host is busy, so one run is noisy (the same code measured 23 to 56 ms mean). Run up to N attempts and keep, per number,
// the best one: a real slowdown shows in every attempt, host load only in some. Compare mode stops once within budget.
const ATTEMPTS = Math.max(1, Number(env.PLAYTEST_RUNS) || 3);
const STEP = 1000 / 60; // frame times land on vsync steps, so p50/p95/p99 may move one step before they count as slower
const limit = (k, b) => k === 'mean' ? b * 1.1 : Math.max(b * 1.1, b + STEP);
const over = (r, b) => Object.keys(b.frameMs).filter(k => r.frameMs[k] > limit(k, b.frameMs[k]));
// Other work on the host steals CPU and inflates every number (the phone profile throttles the CPU 4x, so it suffers most).
// Wait up to 3 minutes for a quiet host, then play anyway and record the load so a noisy result is recognisable.
async function quietHost() {
  const quiet = cpus().length / 4;
  for (let t = 0; t < 18 && loadavg()[0] > quiet; t++) { if (t === 0) console.log(`  host load ${loadavg()[0].toFixed(1)} is high; waiting for it to drop`); await sleep(10000); }
  return +loadavg()[0].toFixed(1);
}
async function bestOf(profile, backend, b) {
  const attempts = [];
  let best = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const hostLoad = await quietHost();
    const run = await playRoute(profile, backend);
    attempts.push(run.failed ? { failed: run.failed, hostLoad } : { ...run.frameMs, unfocusedFrames: run.unfocusedFrames, hostLoad });
    if (!run.failed && !run.unfocusedFrames) {
      if (best && !best.failed && !best.unfocusedFrames) { for (const k of Object.keys(run.frameMs)) if (run.frameMs[k] < best.frameMs[k]) best.frameMs[k] = run.frameMs[k]; } else best = run;
    } else if (!best) best = run; // keep a bad attempt only until a good one replaces it
    if (!best.failed && !best.unfocusedFrames && !savingBaseline && b && !over(best, b).length) break;
    if (i < ATTEMPTS) console.log(`  attempt ${i}: ${run.failed ? `failed (${run.failed})` : `mean ${run.frameMs.mean} ms`}; trying again`);
  }
  best.attempts = attempts;
  return best;
}
let base = null;
if (!savingBaseline) { try { base = JSON.parse(readFileSync(BASELINE, 'utf8')).runs; } catch (e) { die(`cannot read baseline ${BASELINE}: ${e.message}`); } }
let exitCode = 0;
try {
  if (!externalUrl) {
    console.log('Building the game against the local database…');
    dist = mkdtempSync(join(tmpdir(), 'bt-dist-'));
    execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { stdio: 'ignore', env: { ...env, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey } });
    server = await serve(dist);
  }
  rmSync(RESULTS, { recursive: true, force: true });
  const runs = [];
  for (const profile of Object.keys(PROFILES)) for (const backend of Object.keys(BACKENDS)) {
    if (env.PLAYTEST_ONLY && env.PLAYTEST_ONLY !== `${profile}/${backend}`) continue; // dev filter, e.g. phone/webgl2
    console.log(`Playing ${profile} on ${backend}…`);
    const run = await bestOf(profile, backend, base?.find(x => x.profile === profile && x.backend === backend));
    runs.push(run);
    console.log(run.failed ? `  FAILED: ${run.failed}` : `  frame ms p50 ${run.frameMs.p50} p95 ${run.frameMs.p95} p99 ${run.frameMs.p99}, input delay ${run.inputDelayMs} ms, GPU ${run.gpu.adapter?.vendor ?? run.gpu.gameRenderer}, game context ${run.gpu.gameContext}`);
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/latest.json`, JSON.stringify({ createdAt: new Date().toISOString(), runs }, null, 2));
  const problems = runs.filter(r => r.failed).map(r => `${r.profile}/${r.backend}: run failed: ${r.failed}`);
  problems.push(...runs.filter(r => !r.failed && r.unfocusedFrames > 0).map(r => `${r.profile}/${r.backend}: ${r.unfocusedFrames} unfocused frames, numbers are not trustworthy`));
  if (savingBaseline) {
    if (problems.length) die(`not saving a baseline from a bad run:\n${problems.join('\n')}`);
    mkdirSync('tests/perf', { recursive: true });
    writeFileSync(BASELINE, JSON.stringify({ createdAt: new Date().toISOString(), attempts: ATTEMPTS, runs: runs.map(({ profile, backend, frameMs, gpu }) => ({ profile, backend, gameContext: gpu.gameContext, frameMs })) }, null, 2));
    console.log(`Baseline saved to ${BASELINE}`);
  } else {
    for (const r of runs.filter(x => !x.failed)) {
      const b = base.find(x => x.profile === r.profile && x.backend === r.backend);
      if (!b) { problems.push(`${r.profile}/${r.backend}: no baseline entry`); continue; }
      if (b.gameContext && r.gpu.gameContext !== b.gameContext) problems.push(`${r.profile}/${r.backend}: the game rendered with ${r.gpu.gameContext}, the baseline was ${b.gameContext}`);
      for (const k of over(r, b)) problems.push(`${r.profile}/${r.backend}: frame time ${k} ${r.frameMs[k]} ms is ${Math.round((r.frameMs[k] / b.frameMs[k] - 1) * 100)}% over baseline ${b.frameMs[k]} ms (limit ${k === 'mean' ? '10%' : '10% or one 16.7 ms frame step'}, best of ${r.attempts.length}, host load during attempts ${r.attempts.map(a => a.hostLoad).join('/')} on ${cpus().length} cores)`);
    }
  }
  if (problems.length) { console.error(`PLAYTEST FAILED\n${problems.join('\n')}`); exitCode = 1; } else console.log('PLAYTEST PASSED: every profile within 10% of the baseline.');
} catch (error) {
  console.error(`playtest: ${error.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
