// Netlify transforms and caches runtime copies; editable source files stay intact.
export function hostedAssetUrl(url, hostname) {
  if (hostname !== 'play-blocktopia.netlify.app' && !hostname.endsWith('--play-blocktopia.netlify.app')) return url;
  if (!/^\/textures\/.*\.(png|jpe?g|webp)$/.test(url)) return url;
  const size = url.endsWith('/natural-atlas.png') ? '' : '&w=512';
  return `/.netlify/images?url=${encodeURIComponent(url)}&fm=webp&q=90${size}`;
}
