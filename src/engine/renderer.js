import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildChunkMesh } from './mesher.js';
import { buildAtlas } from '../ui/atlas.js';

const SKY_TOP = 0x3d7edb;      // deep zenith blue
const SKY_HORIZON = 0xbfe3ff;  // pale horizon
const IS_MOBILE = navigator.maxTouchPoints > 0;

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    // shadows: full quality on desktop, off on mobile (fill-rate)
    this.renderer.shadowMap.enabled = !IS_MOBILE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 40, 0);

    this._setupLighting();
    this._setupFog();
    this._setupSky();
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

    this._setupComposer();
    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    const hemi = new THREE.HemisphereLight(0xe8f2ff, 0xc7b299, 1.3);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff4d0, 1.05);
    this.sunLight.position.set(50, 80, 30);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    if (!IS_MOBILE) {
      this.sunLight.castShadow = true;
      const cam = this.sunLight.shadow.camera;
      cam.left = -56; cam.right = 56; cam.top = 56; cam.bottom = -56;
      cam.near = 1; cam.far = 260;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      this.sunLight.shadow.bias = -0.0004;
      this.sunLight.shadow.normalBias = 0.5;
    }
  }

  _setupFog() {
    const fogDist = IS_MOBILE ? 48 : 90;
    this.scene.fog = new THREE.Fog(SKY_HORIZON, fogDist * 0.55, fogDist);
  }

  _setupSky() {
    // gradient dome: zenith blue fading to pale horizon, follows the camera
    const geo = new THREE.SphereGeometry(320, 16, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon;
        varying float vY;
        void main() {
          float t = smoothstep(0.0, 0.5, vY);
          gl_FragColor = vec4(mix(horizon, top, t), 1.0);
        }`,
    });
    this._sky = new THREE.Mesh(geo, mat);
    this._sky.renderOrder = -1;
    this.scene.add(this._sky);
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

  _setupComposer() {
    if (IS_MOBILE) return; // plain render path on mobile
    this._composer = new EffectComposer(this.renderer);
    this._composer.addPass(new RenderPass(this.scene, this.camera));
    this._bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.5, 0.88,
    );
    this._composer.addPass(this._bloom);
    this._composer.addPass(new OutputPass());
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._composer?.setSize(window.innerWidth, window.innerHeight);
  }

  updateChunk(chunk, world) {
    const key = `${chunk.cx},${chunk.cz}`;
    this._disposeChunk(key);

    const geo = buildChunkMesh(chunk, world);
    const group = [];
    if (geo._posCount > 0) {
      const m = new THREE.Mesh(geo, this._material);
      m.castShadow = true;
      m.receiveShadow = true;
      group.push(m);
    } else {
      geo.dispose();
    }
    if (geo.water) {
      const w = new THREE.Mesh(geo.water, this._waterMaterial);
      w.renderOrder = 1; // draw after solids so transparency blends correctly
      w.receiveShadow = true;
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
    const cam = this.camera.position;
    if (this._clouds) {
      this._cloudTex.offset.x = (performance.now() * 0.000004) % 1;
      this._clouds.position.x = cam.x;
      this._clouds.position.z = cam.z;
    }
    this._sky.position.copy(cam);
    // sun + its shadow frustum follow the player so shadows never run out
    this.sunLight.position.set(cam.x + 50, cam.y + 80, cam.z + 30);
    this.sunLight.target.position.set(cam.x, cam.y, cam.z);

    if (this._composer) this._composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
