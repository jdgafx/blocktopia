import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Blockbench generic cube models: 16 authoring units = one world block.
// Keep geometry and named joint pivots in the editable source, not duplicated in code.
export function buildBlockbenchCharacter(model, material) {
  const root = new THREE.Group(); root.name = model.name;
  const elements = new Map(model.elements.map(element => [element.uuid, element]));
  const scale = 1 / 16;
  function add(nodes, parent, parentOrigin = [0, 0, 0]) {
    const parts = [];
    for (const node of nodes) {
      if (typeof node !== 'string') {
        const joint = new THREE.Group(); joint.name = node.name;
        joint.position.fromArray(node.origin.map((v, i) => (v - parentOrigin[i]) * scale));
        if (node.rotation) joint.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad));
        parent.add(joint); add(node.children, joint, node.origin);
        continue;
      }
      const element = elements.get(node);
      if (!element || element.type !== 'cube') throw new Error(`Unsupported Blockbench element: ${node}`);
      const geometry = new THREE.BoxGeometry(...element.to.map((v, i) => (v - element.from[i]) * scale));
      const uv = geometry.attributes.uv;
      ['east', 'west', 'up', 'down', 'south', 'north'].forEach((face, faceIndex) => {
        const [u0, v0, u1, v1] = element.faces[face].uv;
        const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
        const turns = (element.faces[face].rotation || 0) / 90;
        const order = [0, 1, 3, 2];
        for (let i = 0; i < 4; i++) {
          const [u, v] = corners[order[(order.indexOf(i) + turns) % 4]];
          uv.setXY(faceIndex * 4 + i, u / model.resolution.width, 1 - v / model.resolution.height);
        }
      });
      const pivot = new THREE.Group();
      const origin = element.origin || [0, 0, 0];
      pivot.position.fromArray(origin.map((v, i) => (v - parentOrigin[i]) * scale));
      if (element.rotation) pivot.rotation.set(...element.rotation.map(THREE.MathUtils.degToRad));
      const mesh = new THREE.Mesh(geometry, material); mesh.name = element.name;
      mesh.position.fromArray(element.to.map((v, i) => ((v + element.from[i]) / 2 - origin[i]) * scale));
      pivot.updateMatrix(); mesh.updateMatrix();
      geometry.applyMatrix4(pivot.matrix.multiply(mesh.matrix)); parts.push(geometry);
    }
    // One draw call per named joint; cube detail stays editable in Blockbench.
    if (parts.length) {
      const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
      mesh.name = `${parent.name}_geometry`; parent.add(mesh);
      parts.forEach(geometry => geometry.dispose());
    }
  }
  add(model.outliner, root);
  root.userData.head = root.getObjectByName('head');
  root.userData.leftArm = root.getObjectByName('left_arm');
  root.userData.rightArm = root.getObjectByName('right_arm');
  return root;
}
