#!/bin/bash
# ==============================================================================
# BLENDER .GLB TO CLOUDFLARE R2 ZERO-EGRESS ASSET PIPELINE
# Compresses an 80MB Blender Dinosaur down to ~4.5MB (Draco + KTX2 GPU textures)
# Usage: ./scripts/compress-assets.sh ./raw/voltaic_rex.glb voltaic_rex.glb
# ==============================================================================
set -e
RAW_FILE=$1
OUT_NAME=$2

if [ -z "$RAW_FILE" ] || [ -z "$OUT_NAME" ]; then
  echo "Usage: ./scripts/compress-assets.sh <input_raw.glb> <output_name.glb>"
  exit 1
fi

mkdir -p ./compressed
echo "1. Optimizing & Compressing 3D Dinosaur Mesh (Draco + KTX2)..."
npx @gltf-transform/cli optimize "$RAW_FILE" "./compressed/$OUT_NAME" \
  --compress draco \
  --texture-compress ktx2 \
  --texture-size 2048

echo "2. Uploading compressed dinosaur to Cloudflare R2 Bucket..."
npx wrangler r2 object put "blocktopia-next-fable-assets/dinos/$OUT_NAME" \
  --file="./compressed/$OUT_NAME" \
  --content-type="model/gltf-binary"

echo "✅ Uploaded! Available at your Cloudflare R2 Zero-Egress URL: /dinos/$OUT_NAME"
