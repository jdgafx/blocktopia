"""Write an editable Material Maker 1.7 graph; Material Maker renders every map."""
import json
from pathlib import Path
import sys

source = Path(sys.argv[1]) # Material Maker source checkout at tag 1.7
material = json.loads((source / 'addons/material_maker/nodes/material.mmg').read_text())
material.update(name='Material', node_position={'x': 650, 'y': 0})
material['parameters']['size'] = 9
material['parameters']['metallic'] = 0
material['shader_model']['exports'] = {'Blocktopia': {'export_extension': 'png', 'files': [
    {'file_name': '$(path_prefix)-color.png', 'output': 0, 'type': 'texture'},
    {'file_name': '$(path_prefix)-normal.png', 'output': 7, 'type': 'texture'},
    {'file_name': '$(path_prefix)-roughness.png', 'output': 13, 'type': 'texture'},
]}}
shader = {
    'name': 'growth_rings', 'type': 'shader', 'node_position': {'x': 0, 'y': 0},
    'parameters': {'rings': 22}, 'seed_int': 6281,
    'shader_model': {
        'name': 'Blocktopia cut timber', 'shortdesc': 'Cut timber with growth rings and radial splits',
        'inputs': [], 'code': '',
        'parameters': [{'name': 'rings', 'type': 'float', 'label': 'Growth rings', 'min': 8, 'max': 40, 'default': 22, 'step': 1}],
        'global': [
            'float timber_height(vec2 uv, float rings) {',
            ' vec2 p = (uv-vec2(0.46,0.52))*2.0;',
            ' float a = atan(p.y,p.x);',
            ' float r = length(p)*(1.0+0.035*sin(a*5.0)+0.02*sin(a*9.0));',
            ' float grain = 0.012*sin(uv.x*600.0+sin(uv.y*200.0));',
            ' float wave = sin(r*rings*6.283185+0.6*sin(a*3.0)+grain*12.0);',
            ' float ring = smoothstep(0.5,0.95,wave);',
            ' float split = (1.0-smoothstep(0.002,0.014,abs(sin(a*3.0+0.3))))*smoothstep(0.28,0.9,r);',
            ' return clamp(0.66 - ring*0.18 - split*0.45 + grain,0.0,1.0);',
            '}',
        ],
        'outputs': [
            {'type': 'rgb', 'rgb': 'mix(vec3(0.19,0.09,0.035),vec3(0.78,0.57,0.31),timber_height($(uv),$(rings)))', 'shortdesc': 'Timber color'},
            {'type': 'f', 'f': 'timber_height($(uv),$(rings))', 'shortdesc': 'Growth ring height'},
            {'type': 'f', 'f': '0.78 + 0.17*(1.0-timber_height($(uv),$(rings)))', 'shortdesc': 'Dry roughness'},
        ],
    },
}
normal = {'name': 'Normal', 'type': 'normal_map', 'node_position': {'x': 330,'y': 180}, 'parameters': {'size': 9, 'strength': 0.3}}
# Native normal-map node exposes its controls through remote parameters.
normal['parameters'] = {'param0': 9, 'param1': 0.3, 'param2': 0, 'param4': 1}
graph = {'name': 'log-end', 'label': 'Blocktopia cut timber', 'type': 'graph', 'parameters': {}, 'nodes': [shader, normal, material], 'connections': [
    {'from': 'growth_rings', 'from_port': 0, 'to': 'Material', 'to_port': 0},
    {'from': 'growth_rings', 'from_port': 1, 'to': 'Normal', 'to_port': 0},
    {'from': 'growth_rings', 'from_port': 2, 'to': 'Material', 'to_port': 2},
    {'from': 'Normal', 'from_port': 0, 'to': 'Material', 'to_port': 4},
]}
Path(__file__).with_name('log-end.ptex').write_text(json.dumps(graph, indent=2)+'\n')
