import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
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
  run('supabase', ['migration', 'up', '--local']);
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
