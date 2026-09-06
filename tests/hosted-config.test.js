import { expect, it } from 'vitest';
import { checkHostedEnv } from '../scripts/check-hosted-env.mjs';

it('prevents publishing local-only or privileged backend configuration', () => {
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  expect(() => checkHostedEnv(env)).not.toThrow();
  for (const url of ['', 'http://127.0.0.1:54321', 'https://localhost', 'https://[::1]']) {
    expect(() => checkHostedEnv({ ...env, VITE_SUPABASE_URL: url })).toThrow('hosted HTTPS');
  }
  for (const key of ['', 'sb_secret_test', `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`]) {
    expect(() => checkHostedEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow('publishable key');
  }
});
