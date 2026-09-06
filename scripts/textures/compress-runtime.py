#!/usr/bin/env python3
"""Re-encode runtime texture copies; preserve dimensions and source backups."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
textures = root / 'public/textures'
backup = root / 'output/texture-originals'
records = []
for pattern in ('pbr/*.jpg', 'creatures/*.webp', 'animals/*.webp'):
    for path in sorted(textures.glob(pattern)):
        relative = path.relative_to(textures)
        source = backup / relative
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, source)
        args = ['magick', str(source), '-strip']
        if path.suffix == '.jpg':
            args += ['-sampling-factor', '4:4:4', '-quality', '90']
        else:
            args += ['-define', 'webp:lossless=false', '-quality', '82']
        subprocess.run([*args, str(path)], check=True)
        if path.stat().st_size >= source.stat().st_size:
            shutil.copy2(source, path)
        before = subprocess.check_output(['magick', 'identify', '-format', '%wx%h', str(source)], text=True)
        after = subprocess.check_output(['magick', 'identify', '-format', '%wx%h', str(path)], text=True)
        assert before == after, f'Dimensions changed: {relative}'
        records.append({'file': str(relative), 'dimensions': after, 'sourceBytes': source.stat().st_size,
                        'bytes': path.stat().st_size, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
provenance = textures / 'pbr/provenance.json'
data = json.loads(provenance.read_text())
for item in data['sources']:
    item.setdefault('sourceMd5', item['md5'])
    item.setdefault('sourceBytes', item['size'])
    shipped = textures / 'pbr' / item['file']
    item['md5'] = hashlib.md5(shipped.read_bytes()).hexdigest()
    item['size'] = shipped.stat().st_size
data['processing'] = 'Original Poly Haven downloads re-encoded at JPEG quality 90 with 4:4:4 sampling; dimensions unchanged. Original hashes retained as sourceMd5/sourceBytes; shipped hashes and sizes are in ../runtime-encoding.json.'
provenance.write_text(json.dumps(data, indent=2) + '\n')
(textures / 'runtime-encoding.json').write_text(json.dumps({'encoder': 'ImageMagick, JPEG quality 90 (4:4:4), WebP quality 82; dimensions unchanged; retain originals if smaller', 'files': records}, indent=2) + '\n')
print(f'{len(records)} textures: {sum(r["sourceBytes"] for r in records):,} -> {sum(r["bytes"] for r in records):,} bytes')
