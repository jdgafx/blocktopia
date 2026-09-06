import { chromium } from 'playwright-core';
const browser = await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox']});
try {
const page = await browser.newPage();
await page.goto(`${process.env.BASE_URL || 'http://localhost:5173'}/models/characters/README.md`);
console.log(JSON.stringify(await page.evaluate(async () => {
const THREE = await import('/node_modules/three/build/three.module.js');
const {configureCharacterRenderer,characterLoader}=await import('/src/game/character-loader.js');
const renderer=new THREE.WebGLRenderer();configureCharacterRenderer(renderer);
const {groundBiped}=await import('/src/game/character-grounding.js');
const loader=characterLoader();
const results=[];
for(const id of ['mara','ivo','neri','sol']) {
 const {scene,animations}=await loader.loadAsync(`/models/characters/${id}.glb`);
 const bounds=new THREE.Box3().setFromObject(scene);
 const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(animations[0]).play();mixer.update(.7);
 const head=scene.getObjectByName('head');
 const meshes=[];scene.traverse(n=>{if(n.isMesh)meshes.push(n)});
 const feet=['left','right'].map(side=>({joint:scene.getObjectByName(`${side}_leg`),knee:scene.getObjectByName(`${side}_knee`),ankle:scene.getObjectByName(`${side}_ankle`),point:new THREE.Vector3(0,-.17,.07)}));
 scene.position.y=29; const world={getBlock:(x,y)=>y<=(x<0?28:29)?3:0};
 for(let frame=0;frame<120;frame++)groundBiped(scene,feet,world,1/60);
 const soles=feet.map(foot=>foot.ankle.localToWorld(foot.point.clone()).y);
 if(Math.abs(soles[0]-29.005)>.002||Math.abs(soles[1]-30.005)>.002) throw Error(`GLB foot IK failed: ${soles}`);
 results.push({id,soles,bounds:[bounds.min.toArray(),bounds.max.toArray()],headRotation:head.rotation.x,meshes:meshes.length,texture:meshes[0].material.map.image.width,compressed:meshes[0].material.map.isCompressedTexture,legs:['left_leg','right_leg'].map(name=>scene.getObjectByName(name).position.toArray())});
 if(Math.abs(head.rotation.x)<.005 || meshes[0].material.map.image.width!==64 || !meshes[0].material.map.isCompressedTexture) throw Error('Animation or texture did not load');
}
renderer.dispose();return results;
}),null,2));
} finally {await browser.close();}
