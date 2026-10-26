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

// Tests 2 and 3 (frame-time baseline) are replaced by tests/checks/t-013-speed.check.mjs (old-vs-new race, no baseline file).

test('4. the playtest refuses a non-local game address or a non-local database before it opens a browser', { timeout: 60_000 }, () => {
  for (const env of [{ PLAYTEST_URL: 'https://play-blocktopia.netlify.app/' }, { VITE_SUPABASE_URL: 'https://xuntmbxiupovuntwrqpr.supabase.co' }]) {
    const t0 = Date.now();
    const r = spawnSync('npm', ['run', 'playtest'], { cwd: ROOT, encoding: 'utf8', timeout: 50_000, env: { ...process.env, ...env } });
    assert.notEqual(r.status, 0, `playtest accepted ${JSON.stringify(env)}`);
    assert.match(r.stdout + r.stderr, /local/i, 'refusal does not say it runs on local only');
    assert.ok(Date.now() - t0 < 20_000, 'refusal took too long; a browser probably started');
  }
});
