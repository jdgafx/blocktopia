// blocktopia:T-005 check: new graphics engine (three 0.186, WebGPU with WebGL2 fallback); houses, trunks, debris in colour.
// Run: node --test tests/checks/t-005-graphics.check.mjs   Needs Docker + Supabase CLI (local only), Chrome, the Intel GPU.
// Real browser, real GPU, real local DB, real screenshots; no mocks.
//
// INTERFACE the worker builds on top of `npm run playtest` (T-013; this file tests only through it):
// - On each of laptop/webgpu, laptop/webgl2, phone/webgpu, phone/webgl2, for BOTH builds (OLD = PLAYTEST_OLD_REF,
//   NEW = working tree), the runner places the camera in front of a cottage, a tree trunk and fresh break debris
//   (debris: break a block, shoot within 5 frames) and saves one PNG screenshot each, same camera for OLD and NEW.
//   The thing must fill the middle third of the shot.
// - playtest-results/latest.json, per run, adds:
//     shots: { old: { cottage, trunk, debris }, new: { cottage, trunk, debris } }   // PNG paths, relative to the repo
//     engine: { old: { three, backend }, new: { three, backend } }  // three = THREE.REVISION read in the page,
//                                                                 // backend = 'webgpu' | 'webgl2', read from the live renderer
//     pageErrors: { old: [...], new: [...] }                        // uncaught page errors and console errors
//     race: { ..., oldGpuMs, newGpuMs }                             // GPU time per frame (timer queries), median of turns
// - GPU time is part of the 10% budget; its failure line reads e.g. `laptop/webgpu: GPU time 4.1 ms -> 9.0 ms (+120%)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = new URL('../..', import.meta.url).pathname;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
const RUN_MS = 600_000;
const PROFILES = ['laptop/webgpu', 'laptop/webgl2', 'phone/webgpu', 'phone/webgl2'];
const THINGS = ['cottage', 'trunk', 'debris'];
const verdicts = out => out.match(/^PLAYTEST (PASSED|FAILED)\b/gm) ?? [];

function playtest(dir, oldRef = 'feature/core-engine') {
  const r = spawnSync('npm', ['run', 'playtest'], { cwd: dir, encoding: 'utf8', timeout: RUN_MS + 60_000, env: { ...process.env, PLAYTEST_OLD_REF: oldRef } });
  const file = join(dir, 'playtest-results/latest.json');
  return { status: r.status, out: `${r.stdout}${r.stderr}`, results: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

// Minimal PNG reader (8-bit RGB/RGBA, not interlaced: what Chrome screenshots are). Read here, not trusted from the runner.
function readPng(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${path} is not a PNG`);
  let o = 8, w, h, depth, type; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), kind = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; assert.equal(d[12], 0, 'interlaced PNG'); }
    if (kind === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  assert.ok(depth === 8 && (type === 2 || type === 6), `${path}: PNG type ${type}/${depth} not supported`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, up = y ? out[row - stride + x] : 0, c = y && x >= bpp ? out[row - stride + x - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      out[row + x] = (src[x] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f]) & 255;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}
// Share of near-black pixels (every channel below 20 of 255) in the middle third of the shot, where the thing is.
function blackShare(path) {
  const { w, h, px } = readPng(path);
  let dark = 0, n = 0;
  for (let y = Math.floor(h / 3); y < (2 * h) / 3; y += 2) for (let x = Math.floor(w / 3); x < (2 * w) / 3; x += 2) { n++; if (Math.max(...px(x, y)) < 20) dark++; }
  return dark / n;
}

let main = null; // one run of this tree against the default branch, shared by tests 1-3
const mainRun = () => (main ??= playtest(ROOT));
const runFor = (r, key) => r.results?.runs?.find(x => `${x.profile}/${x.backend}` === key);

test('1. cottages, tree trunks and break debris show their own colours on laptop and phone, on WebGPU and WebGL2', { timeout: RUN_MS + 120_000 }, () => {
  const r = mainRun();
  assert.ok(r.results, `playtest-results/latest.json missing:\n${r.out.slice(-1500)}`);
  for (const key of PROFILES) {
    const run = runFor(r, key);
    assert.ok(run, `no result for ${key}`);
    for (const thing of THINGS) {
      const oldShot = run.shots?.old?.[thing], newShot = run.shots?.new?.[thing];
      assert.ok(oldShot && existsSync(join(ROOT, oldShot)) && newShot && existsSync(join(ROOT, newShot)), `${key}: ${thing} shots missing for old or new`);
      // The old build shows these black today: this proves the camera frames the thing and the check sees the fault.
      const was = blackShare(join(ROOT, oldShot)), now = blackShare(join(ROOT, newShot));
      assert.ok(was > 0.05, `${key}: old build ${thing} shot is only ${(was * 100).toFixed(1)}% black; the shot does not frame the ${thing}`);
      assert.ok(now < 0.01, `${key}: new build ${thing} is still ${(now * 100).toFixed(1)}% black (${newShot})`);
    }
  }
});

test('2. the game runs on three 0.186 with real Intel WebGPU, falls back to WebGL2, and shows no page errors', { timeout: RUN_MS + 120_000 }, () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.match(lock.packages?.['node_modules/three']?.version ?? '', /^0\.186\./, 'package-lock does not pin three 0.186.x');
  for (const f of ['terrain-materials', 'buildings', 'vegetation', 'water', 'sky']) {
    assert.doesNotMatch(readFileSync(join(ROOT, `src/engine/${f}.js`), 'utf8'), /onBeforeCompile|ShaderMaterial/, `src/engine/${f}.js still patches shader text`);
  }
  const r = mainRun();
  assert.ok(r.results, 'playtest-results/latest.json missing');
  for (const key of PROFILES) {
    const run = runFor(r, key);
    assert.ok(run, `no result for ${key}`);
    assert.equal(String(run.engine?.new?.three), '186', `${key}: the page runs three r${run.engine?.new?.three}`);
    assert.equal(run.engine?.new?.backend, key.split('/')[1], `${key}: the live renderer is ${run.engine?.new?.backend}`);
    if (key.endsWith('webgpu')) assert.match(String(run.gpu?.adapter?.vendor), /intel/i, `${key}: WebGPU did not bind the Intel GPU`);
    assert.doesNotMatch(JSON.stringify(run.gpu ?? {}), /swiftshader|llvmpipe|softpipe|software/i, `${key}: software GPU`);
    assert.deepEqual(run.pageErrors?.new, [], `${key}: page errors in the new build: ${JSON.stringify(run.pageErrors?.new)}`);
  }
});

test('3. the new engine is no slower than today on all four (work, frame time and GPU time within 10%)', { timeout: RUN_MS + 120_000 }, () => {
  const r = mainRun();
  assert.deepEqual(verdicts(r.out), ['PLAYTEST PASSED'], `the new engine must pass the speed check against feature/core-engine:\n${r.out.slice(-2000)}`);
  assert.equal(r.status, 0, 'exit code');
  for (const key of PROFILES) {
    const run = runFor(r, key);
    assert.ok(run?.race?.oldGpuMs > 0 && run?.race?.newGpuMs > 0, `${key}: no GPU time per frame measured`);
  }
});

test('4. the speed check catches a slowdown that is only on the GPU and names it', { timeout: RUN_MS + 180_000 }, () => {
  // Same draw calls, same CPU work, 4x the pixels to shade: only the GPU gets slower.
  const head = sh('git', ['rev-parse', 'HEAD']).trim();
  const dir = join(tmpdir(), `bt-t005-gpu-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  sh('git', ['worktree', 'add', '--detach', dir, head]);
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    const f = join(dir, 'src/main.js'), src = readFileSync(f, 'utf8'), anchor = '    renderer.render();\n  }\n}';
    assert.ok(src.includes(anchor), 'the game loop in src/main.js changed; update the patch anchor in this check');
    writeFileSync(f, src.replace(anchor, anchor.replace('    renderer.render();', '    if (renderer.renderer.getPixelRatio() !== 2) renderer.renderer.setPixelRatio(2); // once, not a resize per frame\n    renderer.render();')));
    const r = playtest(dir, head);
    assert.deepEqual(verdicts(r.out), ['PLAYTEST FAILED'], `a build with 4x the pixels must give exactly one PLAYTEST FAILED line:\n${r.out.slice(-1500)}`);
    assert.match(r.out, /(laptop|phone)\/(webgpu|webgl2): GPU time [\d.]+ ms -> [\d.]+ ms \(\+\d+%\)/, `the failure does not name a profile and its GPU time:\n${r.out.slice(-1500)}`);
    assert.doesNotMatch(r.out, /: (draw calls|triangles)[^\n]*\+\d+%/, 'the GPU-only build does the same draw work; the failure must come from GPU time');
  } finally { sh('git', ['worktree', 'remove', '--force', dir]); }
});
