import { expect, it } from 'vitest';
import { hostedAssetUrl } from '../src/engine/asset-urls.js';

it('uses native image delivery only on this Netlify site and preserves atlas coordinates', () => {
  const image = '/textures/animals/sauropod-color.webp';
  const optimized = new URL(hostedAssetUrl(image, 'play-blocktopia.netlify.app'), 'https://play-blocktopia.netlify.app');
  expect(optimized.pathname).toBe('/.netlify/images');
  expect(optimized.searchParams.get('url')).toBe(image);
  expect(optimized.searchParams.get('w')).toBe('512');
  expect(hostedAssetUrl(image, 'deploy--play-blocktopia.netlify.app')).toBe(optimized.pathname + optimized.search);
  expect(hostedAssetUrl(image, 'localhost')).toBe(image);
  expect(hostedAssetUrl(image, 'another.netlify.app')).toBe(image);
  for (const path of ['/textures/environment.hdr', 'data:image/png;base64,abcd', '/models/person.glb']) {
    expect(hostedAssetUrl(path, 'play-blocktopia.netlify.app')).toBe(path);
  }
  expect(hostedAssetUrl('/textures/natural-atlas.png', 'play-blocktopia.netlify.app')).not.toContain('&w=');
});
