// Node-only reproducible BB source -> animated glTF -> Meshopt GLB. No DCC/browser required in CI.
import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { nativeGltfpack } from './native-gltfpack.mjs';
import { buildBlockbenchCharacter } from './blockbench.js';

// GLTFExporter uses the browser FileReader API only to serialize its buffer Blob.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:application/octet-stream;base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};
const directory = fileURLToPath(new URL('../../public/models/characters/', import.meta.url));
const packer = await nativeGltfpack();
const decoders = fileURLToPath(new URL('../../public/decoders/basis/', import.meta.url));
await mkdir(decoders, { recursive: true });
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md']) {
  await copyFile(new URL(`../../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url), join(decoders, name));
}
await copyFile(new URL('../../node_modules/three/LICENSE', import.meta.url), join(decoders, 'THREE-LICENSE.txt'));
const temporary = await mkdtemp(join(tmpdir(), 'blocktopia-glb-'));
const diagnostics = [];
try {
  for (const id of ['mara', 'ivo', 'neri', 'sol']) {
    const source = await readFile(join(directory, `${id}.bbmodel`));
    const model = JSON.parse(source);
    if (model.textures.length !== 1) throw new Error(`${id}: exporter requires one palette texture`);
    if (model.animations?.length) throw new Error(`${id}: authored Blockbench clips need explicit conversion; do not silently discard them`);
    const body = model.outliner.find(node => node.name === 'body');
    // Retain existing geometry; split the authored boot/trouser cubes at the hip for ground constraints.
    for (const side of ['left', 'right']) {
      const elements = model.elements.filter(element => new RegExp(`^${side}_(trouser|boot)`).test(element.name));
      if (elements.length !== 3) throw new Error(`${id}: expected three ${side} leg cubes`);
      const ids = new Set(elements.map(element => element.uuid));
      body.children = body.children.filter(uuid => !ids.has(uuid));
      const x = side === 'left' ? -2.88 : 2.88;
      const trouser = elements.find(element => element.name.endsWith('_trouser'));
      const upper = structuredClone(trouser); upper.uuid += '-upper'; upper.name += '_upper'; upper.from[1] = 6;
      trouser.to[1] = 6; model.elements.push(upper);
      model.outliner.push({ name: `${side}_leg`, origin: [x, 10.96, 0], children: [upper.uuid,
        { name: `${side}_knee`, origin: [x, 6, 0], children: [trouser.uuid,
          { name: `${side}_ankle`, origin: [x, 2.8, 0], children: elements.filter(element => element !== trouser).map(element => element.uuid) },
        ] },
      ] });
    }
    const material = new THREE.MeshStandardMaterial({ roughness: .85, metalness: 0 });
    material.name = `${id}_painted_palette`;
    const root = buildBlockbenchCharacter(model, material);
    root.userData = {}; // Runtime node references are not serializable extras.
    const duration = 2 * Math.PI / 1.7;
    const times = Array.from({ length: 61 }, (_, i) => duration * i / 60);
    const tracks = [['head', 'x', .018], ['left_arm', 'z', .025], ['right_arm', 'z', -.02]].map(([name, axis, amplitude]) => {
      const joint = root.getObjectByName(name);
      const values = times.flatMap(time => {
        const rotation = joint.rotation.clone(); rotation[axis] += Math.sin(time * 1.7) * amplitude;
        return new THREE.Quaternion().setFromEuler(rotation).toArray();
      });
      return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
    });
    const animation = new THREE.AnimationClip('idle', duration, tracks);
    // glTF uses top-left UVs; the BB adapter uses Three's bottom-left UVs.
    root.traverse(part => {
      if (!part.isMesh) return;
      const uv = part.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    });
    const result = await new GLTFExporter().parseAsync(root, { animations: [animation], trs: true });
    result.images = [{ uri: model.textures[0].source }];
    result.samplers = [{ magFilter: 9728, minFilter: 9986, wrapS: 33071, wrapT: 33071 }];
    result.textures = [{ source: 0, sampler: 0 }];
    result.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    const input = join(temporary, `${id}.gltf`), output = join(directory, `${id}.glb`);
    await writeFile(input, JSON.stringify(result));
    execFileSync(packer, ['-i', input, '-o', output, '-c', '-ce', 'ext', '-kn', '-vpf', '-tc', '-tu', '-tq', '10', '-tj', '1'], { stdio: 'inherit' });
    const packed = await readFile(output);
    const metadata = JSON.parse(packed.subarray(20, 20 + packed.readUInt32LE(12)).toString());
    if (!metadata.extensionsRequired.includes('KHR_texture_basisu')) throw new Error(`${id}: missing KTX2 Basis texture`);
    if (!metadata.extensionsRequired.includes('EXT_meshopt_compression')) throw new Error(`${id}: missing compressed geometry`);
    diagnostics.push({ id, sourceSha256: createHash('sha256').update(source).digest('hex'), glbSha256: createHash('sha256').update(packed).digest('hex'), bytes: packed.length,
      triangles: metadata.nodes.filter(node => node.mesh !== undefined).reduce((sum, node) => sum + metadata.meshes[node.mesh].primitives.reduce((n, primitive) => n + metadata.accessors[primitive.indices].count / 3, 0), 0),
      drawCalls: metadata.nodes.filter(node => node.mesh !== undefined).reduce((sum, node) => sum + metadata.meshes[node.mesh].primitives.length, 0),
      clips: metadata.animations.map(clip => ({ name: clip.name, channels: clip.channels.length })),
      joints: metadata.nodes.filter(node => /^(head|left_arm|right_arm|left_leg|right_leg|left_knee|right_knee|left_ankle|right_ankle)$/.test(node.name)).map(node => node.name),
    });
  }
  await writeFile(join(directory, 'runtime-diagnostics.json'), JSON.stringify({ exporter: 'three GLTFExporter + native gltfpack v1.2, Meshopt + KTX2 UASTC', assets: diagnostics }, null, 2) + '\n');
  console.log(JSON.stringify(diagnostics, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
