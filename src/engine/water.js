import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraFar, cameraNear, cameraPosition, clamp, cos, dot, exp, float, max, min, mix, normalize, perspectiveDepthToViewZ,
  positionView, positionWorld, pow, reflect, screenUV, select, sin, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';

export class WaterSurface {
  constructor(renderer,camera){
    this.renderer=renderer;this.camera=camera;
    this.size=new THREE.Vector2();this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();
    this.target=new THREE.RenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.target.texture.colorSpace=THREE.LinearSRGBColorSpace;
    this.uniforms={time:uniform(0),sky:uniform(new THREE.Color('#a6cedb')),sunDirection:uniform(new THREE.Vector3(.4,.8,.3))};
    const {time,sky,sunDirection}=this.uniforms;
    const world=positionWorld,distance=positionView.z.negate(),screen=screenUV;
    const wave=vec2(sin(world.x.mul(1.8).add(time.mul(.9))).add(sin(world.z.mul(2.7).sub(time.mul(.7)))),
      cos(world.z.mul(1.9).add(time)).add(sin(world.x.mul(3.1).add(time.mul(.5))))).mul(.035);
    const normal=normalize(vec3(wave.x,1,wave.y));
    const viewZ=uv=>perspectiveDepthToViewZ(texture(this.target.depthTexture,uv).x,cameraNear,cameraFar).negate();
    const thickness=max(0,viewZ(screen).sub(distance));
    const shifted=clamp(screen.add(wave.mul(.055).mul(min(thickness,2))),vec2(.001),vec2(.999));
    const refracted=select(viewZ(shifted).lessThan(distance),screen,shifted);
    const transmission=exp(vec3(.36,.105,.07).negate().mul(min(thickness,35)));
    const view=normalize(cameraPosition.sub(world));
    const fresnel=float(.975).mul(pow(float(1).sub(max(dot(normal,view),0)),5)).add(.025);
    const foam=float(1).sub(smoothstep(.08,.65,thickness)).mul(sin(world.x.mul(8).add(world.z.mul(6)).add(time.mul(2.5))).mul(.35).add(.65));
    const body=texture(this.target.texture,refracted).rgb.mul(transmission).add(vec3(.025,.18,.19).mul(float(1).sub(transmission)));
    const lit=mix(body,sky.mul(.72),clamp(fresnel,0,.88))
      .add(vec3(1,.88,.64).mul(pow(max(dot(reflect(normalize(sunDirection).negate(),normal),view),0),180)).mul(.8));
    this.material=new MeshBasicNodeMaterial({name:'Depth refractive water',transparent:true,depthWrite:false,side:THREE.DoubleSide});
    this.material.colorNode=vec4(mix(lit,vec3(.8,.93,.88),foam.mul(.65)),1);
  }
  render(scene,meshes,sun,quality){
    this.camera.updateMatrixWorld();this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
    const visible=[...meshes.values()].some(mesh=>mesh.geometry.groups.some(group=>group.materialIndex===15)&&this.frustum.intersectsObject(mesh));
    if(!visible){this.renderer.render(scene,this.camera);return;}
    this.renderer.getDrawingBufferSize(this.size);
    const scale=quality==='high'?1:.65,w=Math.max(1,Math.round(this.size.x*scale)),h=Math.max(1,Math.round(this.size.y*scale));
    if(this.target.width!==w||this.target.height!==h)this.target.setSize(w,h);
    this.uniforms.time.value=performance.now()/1000;this.uniforms.sky.value.copy(scene.background);this.uniforms.sunDirection.value.copy(sun);
    const previousTarget=this.renderer.getRenderTarget(),shadowAuto=this.renderer.shadowMap.autoUpdate;
    try{
      this.material.visible=false;
      this.renderer.setRenderTarget(this.target);this.renderer.render(scene,this.camera);
      this.renderer.setRenderTarget(previousTarget);
      this.material.visible=true;this.renderer.shadowMap.autoUpdate=false;
      this.renderer.render(scene,this.camera);
    }finally{this.material.visible=true;this.renderer.setRenderTarget(previousTarget);this.renderer.shadowMap.autoUpdate=shadowAuto;}
  }
  dispose(){this.target.dispose();this.material.dispose();}
}
