import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { ExpeditionSaves, MAX_SAVE_BYTES, SaveConflictError } from '../src/game/saves.js';

const snapshot = () => ({ epoch: 1, lastSeq: 0, entries: [], intentIds: [], supplies: {} });
const input = () => ({ name: 'Saved island', seed: 1234, mode: 'expedition', snapshot: snapshot() });

it('rejects invalid save input before accessing the database', async () => {
  expect(() => new ExpeditionSaves({}, 'wrong')).toThrow('ID');
  const saves = new ExpeditionSaves({ from: () => ({}) }, randomUUID());
  await expect(saves.load('wrong')).rejects.toThrow('ID');
  await expect(saves.save(randomUUID(), 0, input())).rejects.toThrow('revision');
  await expect(saves.create({ ...input(), name: ' ' })).rejects.toThrow('1–48');
  await expect(saves.create({ ...input(), seed: 4294967296 })).rejects.toThrow('seed');
  await expect(saves.create({ ...input(), mode: 'unknown' })).rejects.toThrow('mode');
  await expect(saves.create({ ...input(), snapshot: {} })).rejects.toThrow('snapshot');
  await expect(saves.create({ ...input(), snapshot: { ...snapshot(), extra: 'x'.repeat(MAX_SAVE_BYTES) } }))
    .rejects.toThrow('2 MB');
});

// Opt in against the repo's real local Supabase: BLOCKTOPIA_LOCAL_SAVES_TEST=1 npx vitest run tests/saves.test.js
it.skipIf(process.env.BLOCKTOPIA_LOCAL_SAVES_TEST !== '1')('persists exact snapshots, isolates accounts, and rejects concurrent/stale writes', async () => {
  const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
    .filter((line) => /^VITE_SUPABASE_/.test(line)).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
  const url = env.VITE_SUPABASE_URL;
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(url).hostname);
  const clients = [0, 1, 2].map(() => createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
  const accounts = [];
  const created = [];
  try {
    for (const client of clients.slice(0, 2)) {
      const { data, error } = await client.auth.signUp({
        email: `saves-check-${randomUUID()}@example.com`, password: `Check-${randomUUID()}!`,
      });
      expect(error).toBeNull();
      expect(data.session).toBeTruthy();
      accounts.push(new ExpeditionSaves(client, data.user.id));
    }
    const [owner, stranger] = accounts;
    const original = input();
    original.snapshot = { epoch: 1, lastSeq: 1,
      entries: [{ x: 2, y: 25, z: 4, blockId: 0, epoch: 1, seq: 1, intentId: 'saved-edit' }],
      intentIds: ['saved-edit'], supplies: { 1: 4, 5: 8 } };
    const row = await owner.create(original);
    created.push(row.id);
    expect(row.revision).toBe(1);
    expect((await owner.load(row.id)).snapshot).toEqual(original.snapshot);
    expect((await owner.list()).find((save) => save.id === row.id)).not.toHaveProperty('snapshot');
    expect(await stranger.list()).toEqual([]);
    await expect(stranger.load(row.id)).rejects.toThrow('no longer available');
    const foreignRead = await clients[1].from('saved_expeditions').select().eq('id', row.id);
    expect(foreignRead.data).toEqual([]);
    const foreignUpdate = await clients[1].from('saved_expeditions').update({ name: 'Stolen' }).eq('id', row.id).select();
    expect(foreignUpdate.data).toEqual([]);
    const foreignDelete = await clients[1].from('saved_expeditions').delete().eq('id', row.id).select();
    expect(foreignDelete.data).toEqual([]);
    const impersonation = await clients[1].from('saved_expeditions').insert({ ...input(), user_id: owner.userId });
    expect(impersonation.error).toBeTruthy();
    const anonymousRead = await clients[2].from('saved_expeditions').select().eq('id', row.id);
    expect(anonymousRead.error).toBeTruthy();
    for (const changes of [{ revision: 100 }, { user_id: stranger.userId }, { id: randomUUID() }]) {
      const forbidden = await clients[0].from('saved_expeditions').update(changes).eq('id', row.id);
      expect(forbidden.error).toBeTruthy();
    }
    const attempts = await Promise.allSettled([
      owner.save(row.id, 1, { ...original, name: 'First writer' }),
      owner.save(row.id, 1, { ...original, name: 'Second writer' }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find((result) => result.status === 'rejected').reason).toBeInstanceOf(SaveConflictError);
    const winner = attempts.find((result) => result.status === 'fulfilled').value;
    expect(winner.revision).toBe(2);
    expect(await owner.load(row.id)).toEqual(winner);
    await expect(owner.remove(row.id, 1)).rejects.toBeInstanceOf(SaveConflictError);
    const next = await owner.save(row.id, 2, { seed: 4294967295, mode: 'creative', snapshot: snapshot() });
    expect(next.name).toBe(winner.name);
    expect(next.revision).toBe(3);
    expect(next.seed).toBe(4294967295);
    expect(next.mode).toBe('creative');
    for (const snapshot of [{}, { ...original.snapshot, supplies: null }, { ...original.snapshot, extra: 'x'.repeat(MAX_SAVE_BYTES) }]) {
      const invalid = await clients[0].from('saved_expeditions').update({ snapshot }).eq('id', row.id);
      expect(invalid.error).toBeTruthy();
    }
    expect((await owner.remove(row.id, 3)).id).toBe(row.id);
    expect(await owner.list()).toEqual([]);
    await expect(owner.save(row.id, 3, original)).rejects.toBeInstanceOf(SaveConflictError);
  } finally {
    if (accounts[0]) {
      for (const id of created) {
        const row = await accounts[0].load(id).catch(() => null);
        if (row) await accounts[0].remove(id, row.revision);
      }
    }
    await Promise.all(clients.map((client) => client.auth.signOut()));
  }
}, 30000);
