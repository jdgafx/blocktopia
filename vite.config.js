import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const productionCsp=readFileSync(new URL('./netlify.toml',import.meta.url),'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig({
  server: { headers: isolationHeaders },
  preview: { headers: { ...isolationHeaders, 'Content-Security-Policy': productionCsp } },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
