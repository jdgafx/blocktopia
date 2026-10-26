import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
// Local DB can hold a schema whose migration rows were never recorded (LegacyMigrationApplyError:
// relation already exists). Back up rows, record only the colliding migration, then continue.
// shortcut: a rolled-back dry run proves "already exists"; it does not diff the whole schema.
function migrateLocal() {
  let backedUp = false;
  for (let i = 0; i < 50; i++) {
    try { return run('supabase', ['migration', 'up', '--local']); } catch (error) {
      if (!/LegacyMigrationApplyError/.test(`${error.stderr}${error.stdout}`)) throw error;
      const listing = run('supabase', ['migration', 'list', '--local']);
      const pending = JSON.parse(listing.slice(listing.indexOf('{'))).migrations.find(m => m.local && !m.remote);
      if (!pending || !collides(pending.local)) throw error;
      if (!backedUp) { backupLocalRows(); backedUp = true; }
      console.log(`Recording migration ${pending.local} (its objects already exist).`);
      run('supabase', ['migration', 'repair', '--local', '--status', 'applied', pending.local]);
    }
  }
  throw new Error('Too many migration repairs');
}
function collides(version) {
  const file = readdirSync('supabase/migrations').find(f => f.startsWith(`${version}_`));
  const sql = `begin;\n${readFileSync(`supabase/migrations/${file}`, 'utf8')}\nrollback;`;
  try { run('docker', ['exec', '-i', `supabase_db_${projectId()}`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }); return false; }
  catch (error) { return /already exists/.test(String(error.stderr)); }
}
const projectId = () => readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)[1];
function backupLocalRows() {
  mkdirSync('supabase/.temp', { recursive: true });
  const file = `supabase/.temp/rows-backup-${Date.now()}.sql`;
  writeFileSync(file, run('docker', ['exec', `supabase_db_${projectId()}`, 'pg_dump', '-U', 'postgres', '--data-only', '--inserts', '--schema=public', '--schema=auth', '--schema=supabase_migrations', 'postgres'], { maxBuffer: 1 << 30 }), { mode: 0o600 });
  console.log(`Local rows backed up to ${file}`);
}
let server;
let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  server?.kill(signal);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop());
try {
  console.log('Starting Blocktopia accounts and multiplayer…');
  run('supabase', ['start', '-x', 'analytics,vector,studio,imgproxy,edge-runtime']);
  migrateLocal();
  const config = JSON.parse(run('supabase', ['status', '-o', 'json']));
  // Local settings travel only through this process; never overwrite hosted .env files.
  const env = { ...process.env, VITE_SUPABASE_URL: config.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.PUBLISHABLE_KEY || config.ANON_KEY };
  console.log('Play: http://127.0.0.1:5173\nLocal test inbox: http://127.0.0.1:54324');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit', env });
  server.on('error', () => { console.error('Could not start the game server.'); process.exitCode = 1; });
  server.on('exit', code => {
    process.exitCode = code || 0;
    console.log('Game stopped. Local accounts remain saved. Stop backend containers with: supabase stop');
  });
} catch (error) {
  console.error('Could not start Blocktopia. Check that Docker and the Supabase CLI are installed and running.');
  // Backend command output can contain credentials; retain it locally, never echo it.
  mkdirSync('supabase/.temp', { recursive: true });
  writeFileSync('supabase/.temp/play-error.log', String(error.stderr || error.message), { mode: 0o600 });
  console.error('Details saved in supabase/.temp/play-error.log');
  process.exitCode = 1;
}
