// blocktopia:T-013 check: a speed check that repeats on this busy laptop. Run: node --test tests/checks/t-013-speed.check.mjs
// Needs Docker + Supabase CLI (local only), Chrome and the Intel GPU. Real browser, real GPU, real local DB; no mocks.
//
// INTERFACE the worker builds (this file tests only through it):
// - `npm run playtest` builds TWO games: OLD = git ref in env PLAYTEST_OLD_REF (default: feature/core-engine),
//   NEW = the current working tree (uncommitted edits included). It plays both on laptop and phone profiles,
//   on real Intel WebGPU and forced WebGL2, in turns (old, new, old, new ...) inside the same run.
// - Work per frame: counts from the renderer (draw calls, triangles) on a route scripted by frame number, not by
//   wall-clock time, with the game's auto quality pinned, so the same code gives the same counts on every run.
// - Speed: per-frame work time (time spent inside the game's frame callback, game update + render submit, measured
//   in the page) of OLD vs NEW from the in-turns race; background load hits both builds alike.
// - No busy-host refusal: every run ends with exactly one verdict line, `PLAYTEST PASSED` (exit 0) or
//   `PLAYTEST FAILED` (exit 1). Each failure line names `<profile>/<backend>` and the number that grew, e.g.
//   `phone/webgl2: draw calls per frame 412 -> 824 (+100%)` or `laptop/webgpu: frame work 6.1 ms -> 7.4 ms (+21%)`.
// - playtest-results/latest.json: { runs: [ { profile, backend, viewport, gpu, unfocusedFrames, video,
//     work: { old: { calls, triangles }, new: { calls, triangles } },   // per-frame median counts
//     race: { oldMs, newMs, rounds } } ] }                             // per-frame work time, median of turns
// - Budget: NEW fails when its work per frame or its frame work time is more than 10% over OLD.
// The two "worse build" patches below change src/main.js in a temporary copy; the check never edits this tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const ROOT = new URL('../..', import.meta.url).pathname;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
const sql = q => sh('docker', ['exec', 'supabase_db_blocktopia', 'psql', '-U', 'postgres', '-tAc', q]).trim();
const portFree = port => new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
const HEAD = sh('git', ['rev-parse', 'HEAD']).trim();
const RUN_MS = 600_000; // one full playtest run must finish in under 10 minutes
const PROFILES = ['laptop/webgpu', 'laptop/webgl2', 'phone/webgpu', 'phone/webgl2'];

// One playtest run in `dir`, racing the working tree there against HEAD of this branch.
function playtest(dir) {
  const t0 = Date.now();
  const r = spawnSync('npm', ['run', 'playtest'], { cwd: dir, encoding: 'utf8', timeout: RUN_MS + 60_000, env: { ...process.env, PLAYTEST_OLD_REF: HEAD } });
  const out = `${r.stdout}${r.stderr}`;
  const file = join(dir, 'playtest-results/latest.json');
  return { status: r.status, out, ms: Date.now() - t0, results: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}
// A temporary copy of HEAD with one change to the game loop, so NEW is worse than OLD in one known way.
function patchedCopy(name, edit) {
  const dir = join(tmpdir(), `bt-t013-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  sh('git', ['worktree', 'add', '--detach', dir, HEAD]);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const f = join(dir, 'src/main.js');
  const src = readFileSync(f, 'utf8');
  const anchor = '    renderer.render();\n  }\n}';
  assert.ok(src.includes(anchor), 'the game loop in src/main.js changed; update the patch anchor in this check');
  writeFileSync(f, src.replace(anchor, edit(anchor)));
  return { dir, done: () => sh('git', ['worktree', 'remove', '--force', dir]) };
}
const verdicts = out => out.match(/^PLAYTEST (PASSED|FAILED)\b/gm) ?? [];
let unchanged = null; // the last unchanged run, reused to size the slow-build patch

test('1. on this busy laptop every run gives a verdict, and unchanged code passes 3 runs in a row with the same work counts', { timeout: 3 * (RUN_MS + 120_000) }, async () => {
  const counts = [];
  for (let i = 1; i <= 3; i++) {
    const r = playtest(ROOT);
    assert.doesNotMatch(r.out, /host busy|NOT JUDGED|speed not judged/i, `run ${i} refused a verdict:\n${r.out.slice(-1500)}`);
    assert.deepEqual(verdicts(r.out), ['PLAYTEST PASSED'], `run ${i}: unchanged code must give exactly one PLAYTEST PASSED line:\n${r.out.slice(-1500)}`);
    assert.equal(r.status, 0, `run ${i} exit code`);
    assert.ok(r.ms < RUN_MS, `run ${i} took ${Math.round(r.ms / 1000)} s; one run must finish in under 10 minutes`);
    assert.ok(r.results, `run ${i}: playtest-results/latest.json missing`);
    const runs = r.results.runs;
    for (const key of PROFILES) {
      const run = runs.find(x => `${x.profile}/${x.backend}` === key);
      assert.ok(run, `run ${i}: no result for ${key}`);
      for (const side of ['old', 'new']) for (const k of ['calls', 'triangles']) assert.ok(run.work?.[side]?.[k] > 0, `run ${i}: ${key} work.${side}.${k} missing`);
      assert.ok(run.race?.oldMs > 0 && run.race?.newMs > 0 && run.race?.rounds >= 2, `run ${i}: ${key} has no old-vs-new race in turns`);
      assert.equal(run.unfocusedFrames, 0, `run ${i}: ${key} had unfocused frames`);
      assert.doesNotMatch(JSON.stringify(run.gpu ?? {}), /swiftshader|llvmpipe|softpipe|software/i, `run ${i}: ${key} ran on a software GPU`);
      if (key.endsWith('webgpu')) assert.match(String(run.gpu?.adapter?.vendor), /intel/i, `run ${i}: ${key} did not bind the Intel adapter`);
    }
    assert.equal(runs.find(x => x.profile === 'phone').viewport.width, 390, 'phone profile is not 390 px wide');
    counts.push(Object.fromEntries(runs.map(x => [`${x.profile}/${x.backend}`, x.work.new])));
    unchanged = r.results;
  }
  for (const key of PROFILES) for (const k of ['calls', 'triangles']) {
    const v = counts.map(c => c[key][k]);
    const spread = (Math.max(...v) - Math.min(...v)) / Math.min(...v);
    assert.ok(spread <= 0.02, `${key} ${k} per frame moved ${v.join(' / ')} across 3 runs of the same code (limit 2%)`);
  }
});

test('2. a build that draws more per frame fails and names the profile and the count that grew', { timeout: RUN_MS + 180_000 }, () => {
  const copy = patchedCopy('more-work', a => a.replace('renderer.render();', 'renderer.render();renderer.render();')); // every frame drawn twice
  try {
    const r = playtest(copy.dir);
    assert.deepEqual(verdicts(r.out), ['PLAYTEST FAILED'], `a build drawing every frame twice must give exactly one PLAYTEST FAILED line:\n${r.out.slice(-1500)}`);
    assert.equal(r.status, 1, 'exit code');
    for (const key of PROFILES) assert.match(r.out, new RegExp(`${key.replace('/', '\\/')}: (draw calls|triangles)[^\\n]*\\+\\d+%`), `the failure does not name ${key} and the work count that grew:\n${r.out.slice(-1500)}`);
  } finally { copy.done(); }
});

test('3. a build doing the same work but slower per frame fails from the old-vs-new race in turns', { timeout: 2 * (RUN_MS + 180_000) }, () => {
  if (!unchanged) unchanged = playtest(ROOT).results;
  assert.ok(unchanged?.runs?.every(x => x.race?.oldMs > 0), 'no unchanged race result to size the slow build from');
  // Busy-wait 25% of the heaviest profile's frame work: every profile is at least 25% slower, with the same draw work.
  const waitMs = +Math.max(1, 0.25 * Math.max(...unchanged.runs.map(x => x.race.oldMs))).toFixed(2);
  const copy = patchedCopy('slower', a => a.replace('    renderer.render();', `    {const t=performance.now();while(performance.now()-t<${waitMs}){}}\n    renderer.render();`));
  try {
    const r = playtest(copy.dir);
    assert.deepEqual(verdicts(r.out), ['PLAYTEST FAILED'], `a build ${waitMs} ms slower per frame must give exactly one PLAYTEST FAILED line:\n${r.out.slice(-1500)}`);
    assert.equal(r.status, 1, 'exit code');
    assert.match(r.out, /(laptop|phone)\/(webgpu|webgl2): frame work [\d.]+ ms -> [\d.]+ ms \(\+\d+%\)/, `the failure does not name a profile and its frame work old -> new:\n${r.out.slice(-1500)}`);
    assert.doesNotMatch(r.out, /: (draw calls|triangles)[^\n]*\+\d+%/, 'the slow build does the same work; the failure must come from the race, not the counts');
    assert.ok(r.ms < RUN_MS, `the run took ${Math.round(r.ms / 1000)} s; limit 10 minutes`);
  } finally { copy.done(); }
});

test('4. what T-004 got right stays: play on the existing local DB, local-only refusal, ports freed, test rows removed', { timeout: 900_000 }, async () => {
  // Guards met T-004 parts; it may pass today. The GPU and profile parts are asserted in test 1 on every run.
  sh('supabase', ['start', '-x', 'analytics,vector,studio,imgproxy,edge-runtime']);
  const tables = ['world_chunks', 'saved_expeditions', 'blocktopia_room_actors'];
  const before = Object.fromEntries(tables.map(t => [t, sql(`select count(*) from public.${t}`)]));
  const child = spawn('npm', ['run', 'play'], { cwd: ROOT, detached: true });
  let out = '';
  const started = await new Promise(res => {
    const timer = setTimeout(() => res(false), 300_000);
    const seen = d => { out += d; if (out.includes('Play: http://127.0.0.1:5173')) { clearTimeout(timer); res(true); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', () => { clearTimeout(timer); res(false); });
  });
  try { process.kill(-child.pid, 'SIGINT'); } catch {}
  assert.ok(started, `npm run play did not reach the play address:\n${out.slice(-1500)}`);
  for (const t of tables) assert.equal(sql(`select count(*) from public.${t}`), before[t], `${t} row count changed`);
  for (const env of [{ PLAYTEST_URL: 'https://play-blocktopia.netlify.app/' }, { VITE_SUPABASE_URL: 'https://xuntmbxiupovuntwrqpr.supabase.co' }]) {
    const t0 = Date.now();
    const r = spawnSync('npm', ['run', 'playtest'], { cwd: ROOT, encoding: 'utf8', timeout: 50_000, env: { ...process.env, ...env } });
    assert.notEqual(r.status, 0, `playtest accepted ${JSON.stringify(env)}`);
    assert.match(r.stdout + r.stderr, /local/i, 'the refusal does not say it runs on local only');
    assert.ok(Date.now() - t0 < 20_000, 'the refusal took too long; a browser probably started');
  }
  for (const port of [4173, 5173]) assert.ok(await portFree(port), `port ${port} still in use`);
  const who = "(select id from auth.users where email = 'playtest-player@example.test')";
  assert.equal(sql(`select count(*) from public.blocktopia_room_actors where user_id = ${who}`), '0', 'the test player\'s rooms were left behind');
  assert.equal(sql(`select count(*) from public.saved_expeditions where user_id = ${who}`), '0', 'the test player\'s saved worlds were left behind');
});
