# Material Maker cut timber

`log-end.ptex` is an editable native Material Maker graph authored for Blocktopia.
The shader provides adjustable growth rings, off-center heartwood, radial drying
splits and fine saw grain. Its native normal-map node converts height; its
material export node writes color, normal and roughness maps. These replace only
the log-end atlas tile. Existing Poly Haven scans remain in use.

Reproduce using the free Material Maker 1.7 source and official Godot 4.7 editor:

```sh
# Import the source project once:
/path/to/Godot_v4.7-stable_linux.x86_64 --headless --editor \
  --path /path/to/material-maker-1.7 --import
# Export from this repository root (requires Pillow for downsampling):
xvfb-run -a env VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
  python scripts/materials/export-log-end.py \
  /path/to/material-maker-1.7 /path/to/Godot_v4.7-stable_linux.x86_64
```

The source project needs a temporary CLI startup wait for the asynchronous
rendering device. Without it, official binaries crashed on this host and source
execution produced shader errors and a flat normal map. The wrapper applies and
restores that wait, verifies each raw channel is nonconstant, downsamples the
actual 2048px exports to 512px, and records hashes. Only downsampling uses Pillow;
all image content is rendered by Material Maker. Source still logs unrelated
Steam-not-installed and shutdown resource warnings. The process exits normally.

Open `log-end.ptex` in Material Maker to edit its nodes. To rebuild the native
project from its authored recipe:

```sh
python scripts/materials/author-log-end.py /path/to/material-maker-1.7
```

The generated maps are local assets with no runtime service or API requirement.
Color is sRGB; normal and roughness are linear. This is a cut face for individual
voxel logs, not a seamless continuous floor texture.

Material Maker: https://www.materialmaker.org/
Source: https://github.com/RodZill4/material-maker/tree/1.7
Godot: https://github.com/godotengine/godot/releases/tag/4.7-stable
CLI: https://rodzill4.github.io/material-maker/doc/command_line.html

The embedded native material node derives from MIT-licensed Material Maker;
its license is retained alongside this file. The original growth-ring shader
and its exports were authored for this project.
