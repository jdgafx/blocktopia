import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('retains a connected editable native Material Maker graph with actual PBR export channels', () => {
  const graph = JSON.parse(readFileSync(new URL('../scripts/materials/log-end.ptex', import.meta.url)));
  const nodes = new Map(graph.nodes.map(node => [node.name, node]));
  expect(graph.type).toBe('graph');
  for (const connection of graph.connections) {
    expect(nodes.has(connection.from)).toBe(true);
    expect(nodes.has(connection.to)).toBe(true);
  }
  const material = nodes.get('Material');
  expect(graph.connections.filter(connection => connection.to === 'Material').map(connection => connection.to_port).sort()).toEqual([0, 2, 4]);
  expect(material.shader_model.exports.Blocktopia.files.map(file => file.output)).toEqual([0, 7, 13]);
  expect(nodes.get('Normal').type).toBe('normal_map');
  expect(nodes.get('growth_rings').shader_model.outputs).toHaveLength(3);
});

it('ships verified 512px native exports with matching provenance', async () => {
  const { createHash } = await import('node:crypto');
  const provenance = JSON.parse(readFileSync(new URL('../public/textures/generated/provenance.json', import.meta.url)));
  expect(provenance.tool).toBe('Material Maker 1.7 source with Godot 4.7');
  expect(provenance.exports).toHaveLength(3);
  for (const entry of provenance.exports) {
    const image = readFileSync(new URL(`../public/textures/generated/${entry.file}`, import.meta.url));
    expect(image.subarray(1, 4).toString()).toBe('PNG');
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([512, 512]);
    expect(createHash('sha256').update(image).digest('hex')).toBe(entry.sha256);
  }
});
