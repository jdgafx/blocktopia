import * as THREE from 'three';

// Colors per tile index [col, row=0] matching BLOCK_DEFS UV tiles
const TILE_COLORS = {
  '0,0': '#5d9e32', // grass top
  '1,0': '#7c5c3a', // grass side
  '2,0': '#8b6040', // dirt
  '3,0': '#7a7a7a', // stone
  '4,0': '#6b4f1e', // log top
  '5,0': '#8c6b2c', // log side
  '6,0': '#3a7a3a', // leaves
  '7,0': '#d4c86e', // sand
  '8,0': '#8a8078', // gravel
  '9,0': '#b8874a', // planks
  '10,0':'#888080', // stone brick
  '11,0':'#c8e8f0', // glass (light blue)
  '12,0':'#666666', // coal ore
  '13,0':'#8a7050', // iron ore
  '14,0':'#333333', // bedrock
  '15,0':'#3d6bde', // water
};

export function buildAtlas() {
  const TILE = 16;
  const SIZE = 256; // 16 tiles across
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  for (const [key, color] of Object.entries(TILE_COLORS)) {
    const [col, row] = key.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    // Subtle border for block definition
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(col * TILE + 0.5, row * TILE + 0.5, TILE - 1, TILE - 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; // canvas y=0 is top; with flipY=true UV v=0 maps to canvas bottom (empty)
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}
