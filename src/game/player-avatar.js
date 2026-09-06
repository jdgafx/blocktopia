import { AnimationMixer, Group, MathUtils, Vector3 } from 'three';
import { characterLoader } from './character-loader.js';
import { groundBiped } from './character-grounding.js';

// One compressed asset request; rigid glTF joints clone independently while immutable GPU resources are shared.
export function createAvatarLibrary() {
  let template;
  const ready = characterLoader()
    .loadAsync('/models/characters/ivo.glb').then(gltf => { template = gltf; });
  return {
    ready,
    create() {
      if (!template) throw new Error('Player avatar assets are not ready');
      const avatar = new Group();
      const model = template.scene.clone(true); avatar.add(model);
      model.scale.setScalar(.75); // Match the existing 1.8-block player collision height.
      model.traverse(part => { if (part.isMesh) part.castShadow = part.receiveShadow = true; });
      const mixer = new AnimationMixer(model);
      for (const clip of template.animations) mixer.clipAction(clip).play();
      avatar.userData.mixer = mixer;
      avatar.userData.feet = ['left', 'right'].map(side => ({
        joint: model.getObjectByName(`${side}_leg`), knee: model.getObjectByName(`${side}_knee`),
        ankle: model.getObjectByName(`${side}_ankle`), point: new Vector3(0, -.17, .07),
      }));
      avatar.userData.arms = ['left_arm', 'right_arm'].map(name => model.getObjectByName(name));
      avatar.userData.phase = 0; avatar.userData.strength = 0;
      return avatar;
    },
    update(avatar, dt, moving, world) {
      if (!(dt > 0) || !Number.isFinite(dt)) return;
      const state = avatar.userData;
      const speed = typeof moving === 'number' ? MathUtils.clamp(moving, 0, 8) : moving ? 3 : 0;
      state.strength = MathUtils.lerp(state.strength, Math.min(speed / 2, 1), 1 - Math.exp(-12 * dt));
      state.phase += dt * Math.min(speed * 2.6, 14);
      state.mixer.update(dt);
      state.feet.forEach((foot, index) => {
        const stride = Math.sin(state.phase + index * Math.PI) * state.strength;
        foot.joint.position.z = stride * .10;
        foot.point.y = -.17 - Math.max(0, stride) * .13;
        state.arms[index].rotation.x = -stride * .4;
      });
      groundBiped(avatar, state.feet, world, dt);
    },
    // Geometry/materials are shared by all peers; removing a peer must not dispose those resources.
    release(avatar) {
      avatar.userData.mixer.stopAllAction();
      avatar.userData.mixer.uncacheRoot(avatar.children[0]);
      avatar.removeFromParent();
    },
  };
}
