import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { buildChunkMesh } from './mesher.js';
import { buildTerrainMaterials } from './terrain-materials.js';
import { Vegetation } from './vegetation.js';
import { Buildings } from './buildings.js';
import { createSky, updateSky } from './sky.js';
import { INTERPOLATION_DELAY_MS, interpolateSamples } from '../network/protocol.js';

export class Renderer {
  constructor(canvas, renderDistance = 4) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb7cfdf);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 40, 0);

    this._setupLighting();
    this._loadEnvironment();
    this.setQuality(renderDistance > 4 ? 'high' : 'balanced');
    this._material = buildTerrainMaterials(this.renderer);
    this._material.ready.catch((error) => {
      console.warn(error.message);
      const status = document.getElementById('menu-status');
      if (status) status.textContent = 'Some surface textures could not load. Reload to retry.';
    });
    this._chunkMeshes = new Map();
    this._vegetation = new Vegetation(this._material[5]);
    this._chunkVegetation = new Map();
    this._buildings = new Buildings(this._material);
    this._chunkBuildings = new Map();
    this._remoteSamples = new Map();
    this._remoteAvatars = new Map();
    this._avatarBodyGeometry = new THREE.BoxGeometry(0.65, 1.15, 0.42);
    this._avatarHeadGeometry = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this._avatarBodyMaterial = new THREE.MeshLambertMaterial({ color: 0xb8643f });
    this._avatarHeadMaterial = new THREE.MeshLambertMaterial({ color: 0xe4b184 });

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    this._sky = createSky(this.scene);
    this.lightingMode = 'daylight';
    this.hemisphere = new THREE.HemisphereLight(0xe5eef5, 0xb1ab98, 2);
    this.scene.add(this.hemisphere);
    this.daySky = new THREE.Color(0xb7cfdf);
    this.nightSky = new THREE.Color(0x34475f);
    this.sunColor = new THREE.Color(0xfff1d8);
    this.moonColor = new THREE.Color(0xbacde4);
    this.sunLight = new THREE.DirectionalLight(this.sunColor, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 180;
    this.scene.add(this.sunLight, this.sunLight.target);
    this._sunDirection = new THREE.Vector3();
    this._shadowRight = new THREE.Vector3();
    this._shadowUp = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
  }

  _loadEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load('/textures/environment.hdr', (texture) => {
      try {
        this._environment = pmrem.fromEquirectangular(texture);
        this.scene.environment = this._environment.texture;
      } finally {
        texture.dispose();
        pmrem.dispose();
      }
    }, undefined, () => {
      pmrem.dispose();
      // Direct and sky lighting remain usable if the environment asset fails to load.
      console.warn('Environment reflections unavailable; using sky and sunlight.');
    });
  }

  setQuality(quality) {
    if (quality !== 'balanced' && quality !== 'high') throw new RangeError('Unknown graphics quality');
    if (quality === this.quality) return;
    this.quality = quality;
    const high = quality === 'high', size = high ? 2048 : 1024;
    this._shadowExtent = high ? 40 : 24;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.5));
    const shadow = this.sunLight.shadow, camera = shadow.camera;
    shadow.map?.dispose(); shadow.map = null;
    shadow.mapSize.set(size, size);
    camera.left = camera.bottom = -this._shadowExtent;
    camera.right = camera.top = this._shadowExtent;
    camera.updateProjectionMatrix();
    this._setupFog(high ? 6 : 4);
  }

  _setupFog(renderDistance) {
    // Stop visibility before the nearest unloaded chunk edge, including mid-chunk movement.
    const far = renderDistance * 16;
    this.scene.fog = new THREE.Fog(this.scene.background, far * 0.5, far);
    this.camera.far = far + 32;
    this.camera.updateProjectionMatrix();
  }

  _updateLighting(now) {
    const phase = this.lightingMode === 'cycle' ? (now % 1200000) / 1200000 * Math.PI * 2 : Math.PI / 3;
    const daylight = Math.max(0, Math.sin(phase));
    this.scene.environmentIntensity = 0.2 + daylight * 0.6;
    this.scene.background.copy(this.nightSky).lerp(this.daySky, Math.sqrt(daylight));
    this.scene.fog.color.copy(this.scene.background);
    this.hemisphere.intensity = 1.35 + daylight * 0.65;
    this.sunLight.color.copy(this.moonColor).lerp(this.sunColor, Math.min(1, daylight * 3));
    this.sunLight.intensity = 0.65 + daylight * 2.05;
    this._sunDirection.set(Math.cos(phase) * 0.65, Math.abs(Math.sin(phase)) * 0.8 + 0.25, 0.4).normalize();
    updateSky(this._sky, this.camera, this._sunDirection, daylight);
    this._shadowRight.crossVectors(this._worldUp, this._sunDirection).normalize();
    this._shadowUp.crossVectors(this._sunDirection, this._shadowRight).normalize();
    const target = this.sunLight.target.position.copy(this.camera.position);
    target.y -= 6;
    // Snap in light space, so following the player does not slide shadows between map pixels.
    const texel = this._shadowExtent * 2 / this.sunLight.shadow.mapSize.x;
    const right = target.dot(this._shadowRight), up = target.dot(this._shadowUp);
    target.addScaledVector(this._shadowRight, Math.round(right / texel) * texel - right);
    target.addScaledVector(this._shadowUp, Math.round(up / texel) * texel - up);
    this.sunLight.position.copy(target).addScaledVector(this._sunDirection, 100);
  }

  setLighting(mode) {
    if (!['daylight', 'cycle'].includes(mode)) throw new RangeError('Unknown lighting mode');
    this.lightingMode = mode;
  }

  setBrightness(exposure) {
    if (!Number.isFinite(exposure) || exposure < 0.8 || exposure > 1.75) throw new RangeError('Brightness must be between 80% and 175%');
    this.renderer.toneMappingExposure = exposure;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    this._vegetationWorld = world;
    this._updateVegetationChunk(chunk, world);
    const oldBuilding = this._chunkBuildings.get(key);
    if (oldBuilding) { this.scene.remove(oldBuilding); this._buildings.remove(oldBuilding); }
    const building = this._buildings.build(chunk);
    this.scene.add(building); this._chunkBuildings.set(key, building);
    if (this._chunkMeshes.has(key)) {
      const old = this._chunkMeshes.get(key);
      this.scene.remove(old);
      old.geometry.dispose();
    }
    const geo = buildChunkMesh(chunk, world);
    if (geo._posCount === 0) { this._chunkMeshes.delete(key); return; }
    const mesh = new THREE.Mesh(geo, this._material);
    mesh.frustumCulled = true;
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._chunkMeshes.set(key, mesh);
    chunk.dirty = false;
    // A canopy edit may belong to a root in another already-rendered chunk.
    for (const other of world.chunks.values()) {
      if (other !== chunk && other.dirty && this.hasChunk(other.cx, other.cz)) this.updateChunk(other, world);
    }
  }

  _updateVegetationChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    const oldVegetation = this._chunkVegetation.get(key);
    if (oldVegetation) { this.scene.remove(oldVegetation); this._vegetation.remove(oldVegetation); }
    const vegetation = this._vegetation.build(chunk, world, this.camera.position);
    this.scene.add(vegetation); this._chunkVegetation.set(key, vegetation);
  }

  _refreshVegetation() {
    const camera = this.camera.position, cell = `${Math.floor(camera.x / 4)},${Math.floor(camera.z / 4)}`;
    if (cell === this._vegetationCell) return;
    this._vegetationCell = cell;
    // LOD only changes existing draw counts/shadow flags: no allocations or geometry rebuilds.
    for (const group of this._chunkVegetation.values()) this._vegetation.setLod(group, camera);
  }

  removeChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const building = this._chunkBuildings.get(key);
    if (building) { this.scene.remove(building); this._buildings.remove(building); this._chunkBuildings.delete(key); }
    const vegetation = this._chunkVegetation.get(key);
    if (vegetation) { this.scene.remove(vegetation); this._vegetation.remove(vegetation); this._chunkVegetation.delete(key); }
    if (this._chunkMeshes.has(key)) {
      const mesh = this._chunkMeshes.get(key);
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this._chunkMeshes.delete(key);
    }
  }

  hasChunk(cx, cz) {
    return this._chunkMeshes.has(`${cx},${cz}`);
  }

  retainChunks(keys) {
    for (const key of this._chunkMeshes.keys()) {
      if (!keys.has(key)) this.removeChunk(...key.split(',').map(Number));
    }
  }

  updateRemotePlayer(id, sample) {
    const samples = this._remoteSamples.get(id) ?? [];
    samples.push({
      at: sample.at,
      position: [...sample.position],
      yaw: sample.yaw,
      pitch: sample.pitch,
    });
    if (samples.length > 20) samples.shift();
    this._remoteSamples.set(id, samples);
    if (!this._remoteAvatars.has(id)) {
      const avatar = new THREE.Group();
      const body = new THREE.Mesh(this._avatarBodyGeometry, this._avatarBodyMaterial);
      const head = new THREE.Mesh(this._avatarHeadGeometry, this._avatarHeadMaterial);
      body.position.y = 0.75;
      head.position.y = 1.58;
      body.castShadow = body.receiveShadow = true;
      head.castShadow = head.receiveShadow = true;
      avatar.add(body, head);
      this.scene.add(avatar);
      this._remoteAvatars.set(id, avatar);
    }
  }

  removeRemotePlayer(id) {
    const avatar = this._remoteAvatars.get(id);
    if (avatar) this.scene.remove(avatar);
    this._remoteAvatars.delete(id);
    this._remoteSamples.delete(id);
  }

  retainRemotePlayers(ids) {
    for (const id of this._remoteAvatars.keys()) {
      if (!ids.has(id)) this.removeRemotePlayer(id);
    }
  }

  _updateRemotePlayers(now) {
    for (const [id, samples] of this._remoteSamples) {
      const age = now - samples[samples.length - 1].at;
      if (age > 10000) {
        this.removeRemotePlayer(id);
        continue;
      }
      const avatar = this._remoteAvatars.get(id);
      avatar.visible = age <= 2000;
      const state = interpolateSamples(samples, now - INTERPOLATION_DELAY_MS);
      if (!state) continue;
      avatar.position.fromArray(state.position);
      avatar.rotation.y = state.yaw;
    }
  }

  render() {
    this._refreshVegetation();
    this._vegetation.update(performance.now() / 1000);
    this._updateLighting(Date.now());
    this._updateRemotePlayers(performance.now());
    this.renderer.render(this.scene, this.camera);
  }
}
