"""Author village NPC sources; open the resulting .bbmodel files in Blockbench."""
import base64
import json
from pathlib import Path
import struct
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[2] / 'public/models/characters'
COLORS = ['28343e', '222820', 'dec799', '2d292b', 'fff6dd', '192d2a', '67392e', 'b7935b', '745735', '7d949c', 'cbd6db', 'f5bd4e']
ROLES = [('mara', '427d63', 'b97750'), ('ivo', 'c87a3b', '8e583a'), ('neri', '5d759d', 'e2b88e'), ('sol', '963f67', '71462f')]
def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'blocktopia/characters/' + name))
def png(palette):
    # 4x4 swatches, 16 pixels each; restrained woven highlights remain crisp at close range.
    rows = bytearray()
    for y in range(64):
        rows.append(0)
        for x in range(64):
            rgb = bytes.fromhex(palette[(y // 16) * 4 + x // 16])
            shade = 3 if x % 4 == 0 and y % 4 == 0 else 0
            rows.extend(min(255, c + shade) for c in rgb)
            rows.append(255)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 64, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')

for index, (name, coat, skin) in enumerate(ROLES):
    palette = COLORS + [coat, skin, '485643', '536c74']
    texture = png(palette)
    elements, bones = [], {}
    for bone, origin in [('body', [0, 0, 0]), ('head', [0, 1.52, 0]), ('left_arm', [-.44, 1.42, 0]), ('right_arm', [.44, 1.42, 0])]:
        bones[bone] = dict(name=bone, origin=[v * 16 for v in origin], uuid=uid(name + '/' + bone), children=[], export=True, isOpen=True)
    def box(label, color, size, pos, bone='body', tilt=0):
        tile = palette.index(color)
        u, v = tile % 4 * 16, tile // 4 * 16
        element = dict(name=label, type='cube', uuid=uid(name + '/' + label), origin=[p * 16 for p in pos], rotation=[0, 0, tilt], box_uv=False,
                       **{'from': [(p - s/2) * 16 for p, s in zip(pos, size)], 'to': [(p + s/2) * 16 for p, s in zip(pos, size)]},
                       faces={face: dict(uv=[u+.5, v+.5, u+15.5, v+15.5], texture=0) for face in ['north', 'east', 'south', 'west', 'up', 'down']})
        elements.append(element); bones[bone]['children'].append(element['uuid'])
    for side, x in [('left', -.18), ('right', .18)]:
        box(side+'_trouser', '28343e', [.23,.65,.3], [x,.36,0])
        box(side+'_boot', '222820', [.27,.17,.4], [x,.09,.07])
        box(side+'_boot_cuff', '745735', [.28,.1,.34], [x,.24,0])
    box('tunic', coat, [.7,.85,.4], [0,1.08,0])
    box('belt', '745735', [.73,.09,.44], [0,.84,0])
    box('belt_buckle', 'dec799', [.12,.12,.04], [.06,.84,.245])
    box('satchel', '745735', [.22,.25,.17], [-.35,.72,.21])
    box('satchel_flap', 'b7935b', [.24,.07,.18], [-.35,.84,.22])
    box('tunic_seam', 'dec799', [.035,.48,.022], [0,1.14,.211])
    for y in [1.06,1.22,1.38]: box('button_'+str(y), 'b7935b', [.04,.04,.025], [.07,y,.228])
    box('collar', 'dec799', [.46,.12,.45], [0,1.49,0])
    for side, sign in [('left',-1), ('right',1)]:
        bone = side+'_arm'
        box(side+'_sleeve', coat, [.23,.72,.28], [sign*.48,1.09,0], bone, sign*7)
        box(side+'_cuff', 'dec799', [.24,.1,.3], [sign*.52,.79,0], bone)
        box(side+'_hand', skin, [.22,.21,.27], [sign*.52,.68,0], bone)
    box('face', skin, [.54,.53,.49], [0,1.8,0], 'head')
    box('hair_crown', '2d292b', [.58,.2,.52], [0,2.04,-.04], 'head')
    box('hair_back', '2d292b', [.56,.44,.11], [0,1.85,-.24], 'head')
    for x in [-.13,.13]:
        box('eye_'+str(x), 'fff6dd', [.1,.08,.035], [x,1.84,.26], 'head')
        box('pupil_'+str(x), '192d2a', [.045,.06,.04], [x,1.84,.28], 'head')
        box('brow_'+str(x), '2d292b', [.11,.028,.04], [x,1.92,.265], 'head')
    box('nose', skin, [.09,.11,.1], [0,1.76,.28], 'head')
    box('mouth', '67392e', [.15,.035,.04], [0,1.67,.26], 'head')
    if index < 2:
        box('hat_brim', 'b7935b', [.85,.09,.8], [0,2.14,0], 'head')
        box('hat_crown', 'b7935b', [.57,.22,.53], [0,2.27,0], 'head')
        box('hat_band', coat, [.59,.07,.55], [0,2.21,0], 'head')
    else:
        box('cap', 'cbd6db' if index == 2 else 'f5bd4e', [.62,.18,.55], [0,2.14,0], 'head')
        box('cap_peak', '28343e', [.46,.045,.24], [0,2.09,.31], 'head')
    if index == 0:
        box('hearth_apron', 'dec799', [.47,.51,.045], [0,.91,.245])
        box('apron_pocket', coat, [.26,.13,.04], [0,.9,.278])
    elif index == 1:
        box('scholar_book', '485643', [.22,.32,.16], [-.54,.57,.11], 'left_arm')
        box('book_pages', 'fff6dd', [.18,.26,.17], [-.54,.57,.12], 'left_arm')
    elif index == 2:
        box('rucksack', '745735', [.53,.6,.3], [0,1.16,-.31])
        box('bedroll', 'cbd6db', [.71,.19,.24], [0,1.54,-.32])
        box('scarf', 'cbd6db', [.56,.18,.47], [0,1.48,.03])
        box('scarf_tail', 'cbd6db', [.16,.34,.055], [-.2,1.27,.24])
    else:
        box('lantern_handle', '7d949c', [.055,.23,.055], [.54,.51,.12], 'right_arm')
        box('lantern_housing', '28343e', [.23,.3,.23], [.54,.26,.12], 'right_arm')
        box('lantern_glass', 'f5bd4e', [.24,.19,.24], [.54,.26,.12], 'right_arm')
        box('keeper_badge', 'f5bd4e', [.13,.13,.03], [-.19,1.29,.23])
    if index != 3: box('walking_staff', '745735', [.09,1.1,.09], [.56,.7,.12], 'right_arm')
    model = dict(meta=dict(format_version='4.10', model_format='free', box_uv=False), name=name, model_identifier=name, visible_box=[1,3,0], resolution=dict(width=64,height=64), elements=elements, outliner=list(bones.values()), textures=[dict(name=name+'.png', id='0', uuid=uid(name+'/texture'), mode='bitmap', source='data:image/png;base64,'+base64.b64encode(texture).decode(), width=64, height=64, uv_width=64, uv_height=64)], animations=[])
    (ROOT / (name+'.bbmodel')).write_text(json.dumps(model, indent=2)+'\n')
    (ROOT / (name+'.png')).write_bytes(texture)
    print(name, len(elements), 'cubes')
