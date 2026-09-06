import * as THREE from 'three';

export class WaterSurface {
  constructor(renderer,camera){
    this.renderer=renderer;this.camera=camera;
    this.size=new THREE.Vector2();this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();
    this.target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.target.texture.colorSpace=THREE.LinearSRGBColorSpace;
    this.uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),sceneColor:{value:this.target.texture},sceneDepth:{value:this.target.depthTexture},resolution:{value:new THREE.Vector2()},near:{value:camera.near},far:{value:camera.far},time:{value:0},sky:{value:new THREE.Color('#a6cedb')},sunDirection:{value:new THREE.Vector3(.4,.8,.3)},eye:{value:camera.position}};
    this.material=new THREE.ShaderMaterial({name:'Depth refractive water',uniforms:this.uniforms,fog:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`#include <fog_pars_vertex>
      varying vec3 vWorld; varying float vDistance;
      void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vec4 view=modelViewMatrix*vec4(position,1.0);vDistance=-view.z;gl_Position=projectionMatrix*view;vec4 mvPosition=view;
      #include <fog_vertex>
      }`,
      fragmentShader:`#include <packing>
      #include <fog_pars_fragment>
      uniform sampler2D sceneColor;uniform sampler2D sceneDepth;uniform vec2 resolution;uniform float near;uniform float far;uniform float time;uniform vec3 sky;uniform vec3 sunDirection;uniform vec3 eye;
      varying vec3 vWorld;varying float vDistance;
      void main(){
        vec2 screen=gl_FragCoord.xy/resolution;
        vec2 wave=vec2(sin(vWorld.x*1.8+time*.9)+sin(vWorld.z*2.7-time*.7),cos(vWorld.z*1.9+time)+sin(vWorld.x*3.1+time*.5))*.035;
        vec3 normal=normalize(vec3(wave.x,1.0,wave.y));
        float rawDepth=texture2D(sceneDepth,screen).x;
        float bottom=-perspectiveDepthToViewZ(rawDepth,near,far);
        float thickness=max(0.0,bottom-vDistance);
        vec2 refracted=clamp(screen+wave*.055*min(thickness,2.0),vec2(.001),vec2(.999));
        float refractedBottom=-perspectiveDepthToViewZ(texture2D(sceneDepth,refracted).x,near,far);
        if(refractedBottom<vDistance)refracted=screen;
        vec3 transmission=exp(-vec3(.36,.105,.07)*min(thickness,35.0));
        vec3 water=vec3(.025,.18,.19);
        vec3 color=texture2D(sceneColor,refracted).rgb*transmission+water*(1.0-transmission);
        vec3 view=normalize(eye-vWorld);float fresnel=.025+.975*pow(1.0-max(dot(normal,view),0.0),5.0);
        color=mix(color,sky*.72,clamp(fresnel,0.0,.88));
        color+=vec3(1.0,.88,.64)*pow(max(dot(reflect(-normalize(sunDirection),normal),view),0.0),180.0)*.8;
        float foam=(1.0-smoothstep(.08,.65,thickness))*(.65+.35*sin(vWorld.x*8.0+vWorld.z*6.0+time*2.5));
        color=mix(color,vec3(.8,.93,.88),foam*.65);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`});
  }
  render(scene,meshes,sun,quality){
    this.camera.updateMatrixWorld();this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
    const visible=[...meshes.values()].some(mesh=>mesh.geometry.groups.some(group=>group.materialIndex===15)&&this.frustum.intersectsObject(mesh));
    if(!visible){this.renderer.render(scene,this.camera);return;}
    this.renderer.getDrawingBufferSize(this.size);
    const scale=quality==='high'?1:.65,w=Math.max(1,Math.round(this.size.x*scale)),h=Math.max(1,Math.round(this.size.y*scale));
    if(this.target.width!==w||this.target.height!==h)this.target.setSize(w,h);
    this.uniforms.resolution.value.copy(this.size);this.uniforms.near.value=this.camera.near;this.uniforms.far.value=this.camera.far;this.uniforms.time.value=performance.now()/1000;this.uniforms.sky.value.copy(scene.background);this.uniforms.sunDirection.value.copy(sun);
    const mapping=this.renderer.toneMapping,previousTarget=this.renderer.getRenderTarget(),shadowAuto=this.renderer.shadowMap.autoUpdate;
    try{
      this.material.visible=false;
      this.renderer.toneMapping=THREE.NoToneMapping;
      this.renderer.setRenderTarget(this.target);this.renderer.clear();this.renderer.render(scene,this.camera);
      this.renderer.toneMapping=mapping;this.renderer.setRenderTarget(previousTarget);
      this.material.visible=true;this.renderer.shadowMap.autoUpdate=false;
      this.renderer.render(scene,this.camera);
    }finally{this.material.visible=true;this.renderer.setRenderTarget(previousTarget);this.renderer.toneMapping=mapping;this.renderer.shadowMap.autoUpdate=shadowAuto;}
  }
  dispose(){this.target.dispose();this.material.dispose();}
}
