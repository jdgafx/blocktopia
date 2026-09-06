"""Export via Material Maker 1.7 source + Godot 4.7; Pillow only downsizes exports."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from PIL import Image, ImageStat

root = Path(__file__).resolve().parents[2]
source, godot = (Path(value).resolve() for value in sys.argv[1:3])
# MM 1.7 CLI starts compiling before its asynchronous rendering device exists.
args = source / 'parse_args.gd'
original = args.read_text()
wait = '\twhile mm_renderer.rendering_device == null:\n\t\tawait get_tree().process_frame\n'
if wait not in original:
    args.write_text(original.replace('func _ready():\n', 'func _ready():\n' + wait, 1))
try:
    with tempfile.TemporaryDirectory(prefix='blocktopia-mm-export-') as temporary:
        command = [str(godot), '--path', str(source), '--export-material', '--target', 'Blocktopia', '-o', temporary, str(root / 'scripts/materials/log-end.ptex')]
        subprocess.run(command, check=True, timeout=180)
        exports = []
        for channel in ['color', 'normal', 'roughness']:
            raw = Path(temporary) / f'log-end-{channel}.png'
            image = Image.open(raw).convert('RGB')
            assert min(ImageStat.Stat(image).stddev) > 1, f'Blank {channel} export'
            target = root / 'public/textures/generated' / raw.name
            target.parent.mkdir(parents=True, exist_ok=True)
            image.resize((512, 512), Image.Resampling.LANCZOS).save(target, optimize=True)
            exports.append({'file': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'raw_sha256': hashlib.sha256(raw.read_bytes()).hexdigest(), 'raw_size': list(image.size), 'size': [512,512]})
        (root / 'public/textures/generated/provenance.json').write_text(json.dumps({'tool': 'Material Maker 1.7 source with Godot 4.7', 'source': 'https://github.com/RodZill4/material-maker/tree/1.7', 'native_project': 'scripts/materials/log-end.ptex', 'recipe': 'scripts/materials/export-log-end.py', 'postprocess': 'Pillow Lanczos downsample only; all channels rendered by Material Maker', 'exports': exports}, indent=2)+'\n')
finally:
    args.write_text(original)
