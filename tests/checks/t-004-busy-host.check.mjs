// blocktopia:T-004 check: on a busy host the playtest still plays and saves the route, but gives no speed verdict. Run: node --test tests/checks/t-004-busy-host.check.mjs
// An impossible CPU limit during the run stands in for a busy host. Expect exit code 3, the plain line, saved numbers and video, no PASS or FAIL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;

test('a busy host plays and saves the route, then refuses the speed verdict with its own exit code', { timeout: 600_000 }, () => {
  const t0 = Date.now();
  const r = spawnSync('node', ['scripts/playtest.mjs'], {
    cwd: ROOT, encoding: 'utf8', timeout: 540_000,
    env: { ...process.env, PLAYTEST_ONLY: 'phone/webgl2', PLAYTEST_CPU_MAX: '0.001', PLAYTEST_WAIT_MIN: '0.1', PLAYTEST_RUN_CPU_MAX: '0.001' },
  });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 3, `expected exit code 3 (host busy). Output:\n${out}`);
  assert.match(out, /host busy: .*CPU [\d.]+% busy.*speed not judged/, out);
  assert.doesNotMatch(out, /PLAYTEST PASSED|PLAYTEST FAILED/, `a busy host must not produce a speed verdict:\n${out}`);
  assert.ok(Date.now() - t0 < 500_000, 'a busy host must not retry the route again and again');
  const file = `${ROOT}playtest-results/latest.json`;
  assert.ok(existsSync(file), 'the numbers were not saved');
  const run = JSON.parse(readFileSync(file, 'utf8')).runs[0];
  assert.ok(run.frameMs?.p50 > 0 && run.frameMs?.p99 > 0, 'frame times missing from the saved run');
  assert.ok(run.busy, 'the saved run does not say the host was busy');
  assert.ok(existsSync(run.video), 'the video was not saved');
});
