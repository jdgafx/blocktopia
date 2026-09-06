#!/usr/bin/env python3
"""Derive tile PBR channels and pack ORM with Pillow (FOSS), preserving source scans."""
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter
import numpy as np
root = Path(__file__).resolve().parents[2] / 'public/textures'
out = root / 'generated'; out.mkdir(exist_ok=True)
atlas = Image.open(root/'natural-atlas.png').convert('RGB')
for name, tile in [('grass-edge',1),('leaf-tile',6)]:
    x,y=tile%4,tile//4
    color=atlas.crop((round(x*atlas.width/4)+2,round(y*atlas.height/4)+2,round((x+1)*atlas.width/4)-2,round((y+1)*atlas.height/4)-2)).resize((512,512),Image.Resampling.LANCZOS)
    color.save(out/f'{name}-color.png',optimize=True)
    height=np.asarray(color.convert('L').filter(ImageFilter.GaussianBlur(1)),dtype=np.float32)/255
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*2;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*2
    normal=np.stack((-dx,dy,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    Image.fromarray(np.uint8(np.clip((normal*.5+.5)*255,0,255))).save(out/f'{name}-normal.png',optimize=True)
    Image.fromarray(np.uint8(190+height*55)).save(out/f'{name}-roughness.png',optimize=True)
for rough in [*(root/'pbr').glob('*-roughness.jpg'),*out.glob('*-roughness.png')]:
    gray=Image.open(rough).convert('L').resize((512,512),Image.Resampling.LANCZOS)
    # Ambient contact occlusion is per-vertex; unoccluded material AO stays white.
    orm=Image.merge('RGB',(Image.new('L',gray.size,255),gray,Image.new('L',gray.size,0)))
    orm.save(rough.with_name(rough.stem.replace('-roughness','-orm')+'.png'),optimize=True)
    if rough.stem=='rock_boulder_dry-roughness':
        Image.merge('RGB',(Image.new('L',gray.size,255),gray,Image.new('L',gray.size,140))).save(out/'iron-orm.png',optimize=True)
print('Packed runtime ORM and authored tile PBR channels')
