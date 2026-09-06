import { readFile, writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const release = 'https://github.com/zeux/meshoptimizer/releases/download/v1.2/gltfpack-ubuntu.zip';
const archiveHash = 'ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1';
const executableHash = '7e0dc08489835df804a83ca111c2cac6f8431f5a7b0e5453d94d6749a988b32f';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function nativeGltfpack() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The reproducible character build requires Linux x64 (Netlify/WSL2/Linux container). See public/models/characters/README.md for other platforms; KTX2 encoding is never silently skipped.');
  }
  const cache = fileURLToPath(new URL('../../node_modules/.cache/blocktopia-gltfpack-v1.2/', import.meta.url));
  const executable = join(cache, 'gltfpack');
  await mkdir(cache, { recursive: true });
  try {
    if (digest(await readFile(executable)) === executableHash) return executable;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(executable, { force: true });
  const response = await fetch(release, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Native gltfpack download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (digest(archive) !== archiveHash) throw new Error('Native gltfpack archive SHA256 mismatch');
  const zip = join(cache, 'release.zip');
  await writeFile(zip, archive);
  try {
    execFileSync('unzip', ['-o', zip, 'gltfpack', '-d', cache], { stdio: 'pipe' });
    if (digest(await readFile(executable)) !== executableHash) throw new Error('Native gltfpack executable SHA256 mismatch');
    await chmod(executable, 0o755);
  } finally { await rm(zip, { force: true }); }
  return executable;
}
