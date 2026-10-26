// blocktopia:T-004 check. Run: node --test tests/checks/t-004-playtest.check.mjs
// Needs Docker + Supabase CLI (local only) and Chrome. One test per done condition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const ROOT = new URL('../..', import.meta.url).pathname;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
const sql = q => sh('docker', ['exec', 'supabase_db_blocktopia', 'psql', '-U', 'postgres', '-tAc', q]).trim();
const portFree = port => new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });

test('1. npm run play starts on the existing local database, keeps every row, and records every migration', { timeout: 600_000 }, async () => {
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
  assert.ok(started, `npm run play did not reach the play address. Output:\n${out.slice(-1500)}`);
  for (const t of tables) assert.equal(sql(`select count(*) from public.${t}`), before[t], `${t} row count changed`);
  const files = sh('ls', ['supabase/migrations']).split('\n').filter(f => f.endsWith('.sql')).map(f => f.split('_')[0]);
  const applied = sql('select version from supabase_migrations.schema_migrations').split('\n');
  for (const v of files) assert.ok(applied.includes(v), `migration ${v} is not recorded as applied`);
});

test('2. npm run playtest measures laptop and phone on real Intel WebGPU and forced WebGL2, then stops its servers', { timeout: 1_800_000 }, async () => {
  const r = spawnSync('npm', ['run', 'playtest'], { cwd: ROOT, encoding: 'utf8', timeout: 1_700_000 });
  assert.equal(r.status, 0, `npm run playtest failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
  const file = join(ROOT, 'playtest-results/latest.json');
  assert.ok(existsSync(file), 'playtest-results/latest.json missing');
  const { runs } = JSON.parse(readFileSync(file, 'utf8'));
  for (const profile of ['laptop', 'phone']) for (const backend of ['webgpu', 'webgl2']) {
    const run = runs.find(x => x.profile === profile && x.backend === backend);
    assert.ok(run, `no run for ${profile}/${backend}`);
    assert.equal(run.unfocusedFrames, 0, `${profile}/${backend} had unfocused frames`);
    for (const k of ['p50', 'p95', 'p99']) assert.ok(run.frameMs?.[k] > 0, `${profile}/${backend} frameMs.${k} missing`);
    assert.ok(run.inputDelayMs > 0, `${profile}/${backend} inputDelayMs missing`);
    assert.doesNotMatch(JSON.stringify(run.gpu ?? {}), /swiftshader|llvmpipe|software/i, `${profile}/${backend} ran on a software GPU`);
    if (backend === 'webgpu') assert.match(String(run.gpu?.adapter?.vendor), /intel/i, `${profile}/webgpu did not bind the Intel adapter`);
  }
  assert.equal(runs.find(x => x.profile === 'phone').viewport.width, 390);
  for (const port of [4173, 5173]) assert.ok(await portFree(port), `port ${port} still in use after the playtest`);
});

test('3. the playtest fails and names the profile when frame time is more than 10% over the saved baseline', { timeout: 1_800_000 }, () => {
  assert.ok(existsSync(join(ROOT, 'tests/perf/baseline.json')), 'tests/perf/baseline.json (the saved baseline) missing');
  const dir = mkdtempSync(join(tmpdir(), 'bt-base-'));
  const tight = join(dir, 'baseline.json');
  const base = JSON.parse(readFileSync(join(ROOT, 'tests/perf/baseline.json'), 'utf8'));
  for (const run of base.runs) for (const k of Object.keys(run.frameMs)) run.frameMs[k] = 1;
  writeFileSync(tight, JSON.stringify(base));
  const r = spawnSync('npm', ['run', 'playtest'], { cwd: ROOT, encoding: 'utf8', timeout: 1_700_000, env: { ...process.env, PLAYTEST_BASELINE: tight } });
  assert.notEqual(r.status, 0, 'playtest passed against an impossible 1 ms baseline');
  assert.match(r.stdout + r.stderr, /laptop|phone/, 'failure output does not name the slow profile');
});

test('4. the playtest refuses a non-local game address or a non-local database before it opens a browser', { timeout: 60_000 }, () => {
  for (const env of [{ PLAYTEST_URL: 'https://play-blocktopia.netlify.app/' }, { VITE_SUPABASE_URL: 'https://xuntmbxiupovuntwrqpr.supabase.co' }]) {
    const t0 = Date.now();
    const r = spawnSync('npm', ['run', 'playtest'], { cwd: ROOT, encoding: 'utf8', timeout: 50_000, env: { ...process.env, ...env } });
    assert.notEqual(r.status, 0, `playtest accepted ${JSON.stringify(env)}`);
    assert.match(r.stdout + r.stderr, /local/i, 'refusal does not say it runs on local only');
    assert.ok(Date.now() - t0 < 20_000, 'refusal took too long; a browser probably started');
  }
});
