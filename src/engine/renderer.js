import * as THREE from 'three';
import { buildChunkMesh } from './mesher.js';
import { buildAtlas } from '../ui/atlas.js';

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 40, 0);

    this._setupLighting();
    this._setupFog();
    this._atlas = buildAtlas();
    this._material = new THREE.MeshLambertMaterial({ map: this._atlas, side: THREE.FrontSide });
    this._chunkMeshes = new Map();

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    this.sunLight = new THREE.DirectionalLight(0xfff4d0, 1.0);
    this.sunLight.position.set(50, 80, 30);
    this.scene.add(this.sunLight);
  }

  _setupFog() {
    const isMobile = navigator.maxTouchPoints > 0;
    const fogDist = isMobile ? 48 : 80;
    this.scene.fog = new THREE.Fog(0x87ceeb, fogDist * 0.6, fogDist);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    if (this._chunkMeshes.has(key)) {
      const old = this._chunkMeshes.get(key);
      this.scene.remove(old);
      old.geometry.dispose();
    }
    const geo = buildChunkMesh(chunk, world);
    if (geo._posCount === 0) { this._chunkMeshes.delete(key); return; }
    const mesh = new THREE.Mesh(geo, this._material);
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this._chunkMeshes.set(key, mesh);
    chunk.dirty = false;
  }

  removeChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this._chunkMeshes.has(key)) {
      const mesh = this._chunkMeshes.get(key);
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this._chunkMeshes.delete(key);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
