import { pathToFileURL } from 'node:url';

export function checkHostedEnv(env) {
  let url;
  try { url = new URL(env.VITE_SUPABASE_URL); } catch {}
  if (!url || url.protocol !== 'https:' || /^(localhost|127\.|\[?::1\]?)/.test(url.hostname)) {
    throw new Error('Set VITE_SUPABASE_URL in Netlify to the hosted HTTPS Supabase project URL. Local Supabase cannot serve public players.');
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  if (key.startsWith('sb_publishable_')) return;
  try {
    if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon') return;
  } catch {}
  throw new Error('Set VITE_SUPABASE_PUBLISHABLE_KEY in Netlify to a publishable key (or use the legacy anon key). Never use a service-role or secret key.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkHostedEnv(process.env);
