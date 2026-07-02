import * as THREE from 'three';
import { buildChunkMesh } from './mesher.js';
import { buildAtlas } from '../ui/atlas.js';

const SKY_COLOR = 0x87ceeb;

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 40, 0);

    this._setupLighting();
    this._setupFog();
    this._setupClouds();
    this._atlas = buildAtlas();
    // ponytail: DoubleSide because legacy face tables mix winding order
    // (top/bot CW, sides CCW); rewinding all faces buys ~nothing at this
    // vertex count and risks regressions. Revisit if mobile fill-rate hurts.
    this._material = new THREE.MeshLambertMaterial({
      map: this._atlas,
      vertexColors: true,
      alphaTest: 0.5, // leaves holes + glass panes
      side: THREE.DoubleSide,
    });
    this._waterMaterial = new THREE.MeshLambertMaterial({
      map: this._atlas,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide, // visible from underwater too
    });
    this._chunkMeshes = new Map();

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    const hemi = new THREE.HemisphereLight(0xdfeeff, 0xb5a58a, 0.85);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff4d0, 0.85);
    this.sunLight.position.set(50, 80, 30);
    this.scene.add(this.sunLight);
  }

  _setupFog() {
    const isMobile = navigator.maxTouchPoints > 0;
    const fogDist = isMobile ? 48 : 90;
    this.scene.fog = new THREE.Fog(SKY_COLOR, fogDist * 0.55, fogDist);
  }

  _setupClouds() {
    // Soft noise blobs on a huge plane drifting overhead
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    let s = 4242;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 40; i++) {
      const x = rand() * 256, y = rand() * 256;
      const w = 12 + rand() * 30, h = 6 + rand() * 12;
      ctx.fillRect(x, y, w, h);
      ctx.fillRect(x + 4, y - 4, w * 0.6, h * 0.6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.repeat.set(3, 3);
    this._cloudTex = tex;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 96;
    this._clouds = plane;
    this.scene.add(plane);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    this._disposeChunk(key);

    const geo = buildChunkMesh(chunk, world);
    const group = [];
    if (geo._posCount > 0) {
      group.push(new THREE.Mesh(geo, this._material));
    } else {
      geo.dispose();
    }
    if (geo.water) {
      const w = new THREE.Mesh(geo.water, this._waterMaterial);
      w.renderOrder = 1; // draw after solids so transparency blends correctly
      group.push(w);
    }
    if (group.length === 0) { chunk.dirty = false; return; }
    for (const m of group) {
      m.frustumCulled = true;
      this.scene.add(m);
    }
    this._chunkMeshes.set(key, group);
    chunk.dirty = false;
  }

  _disposeChunk(key) {
    const group = this._chunkMeshes.get(key);
    if (!group) return;
    for (const mesh of group) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this._chunkMeshes.delete(key);
  }

  removeChunk(cx, cz) {
    this._disposeChunk(`${cx},${cz}`);
  }

  render() {
    if (this._clouds) {
      this._cloudTex.offset.x = (performance.now() * 0.000004) % 1;
      this._clouds.position.x = this.camera.position.x;
      this._clouds.position.z = this.camera.position.z;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
