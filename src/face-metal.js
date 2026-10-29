import { Color, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry, PMREMGenerator, Scene, WebGLRenderTarget, HalfFloatType, LinearFilter, OrthographicCamera, ShaderMaterial, NoBlending, Vector4 } from 'three';
import { defaultStudioColors, studioColorKey, studioColorFields } from './studio-palettes.js';

export function createStudioEnvironment(renderer, colors = defaultStudioColors()) {
  const room = new Scene();room.background = new Color();
  const geometry = new PlaneGeometry(1,1),materials=[];
  function panel(key,intensity,position,size){
    const material=new MeshBasicMaterial({toneMapped:false});materials.push({material,key,intensity});
    const mesh=new Mesh(geometry,material);mesh.position.set(...position);mesh.scale.set(...size,1);mesh.lookAt(0,0,0);room.add(mesh);
  }
  panel('keyColor',4,[0,5,6],[12,4.5]);
  panel('stripColor',7,[0,2.6,7],[12,.55]);
  panel('fillColor',5,[-5,1,1],[5,10]);
  panel('rimColor',4,[-4,3,-4],[3,8]);
  panel('accentColor',3,[5,-1,3],[3,7]);
  panel('bounceColor',2,[1,-4,4],[10,2.4]);
  panel('backColor',.8,[0,0,-7],[10,4]);
  const pmrem=new PMREMGenerator(renderer);
  // Convolution is linear: bake each white source once, then sum tinted,
  // weighted sources. Animated panel levels never regenerate a PMREM.
  const basis=studioColorFields.map((_,i)=>{
    room.background.setRGB(i===0?1:0,i===0?1:0,i===0?1:0);
    materials.forEach(({material,intensity},j)=>material.color.setRGB(j===i-1?intensity:0,j===i-1?intensity:0,j===i-1?intensity:0));
    return pmrem.fromScene(room,.018);
  });
  const template=basis[0],environment=new WebGLRenderTarget(template.width,template.height,{type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false,stencilBuffer:false});
  environment.texture.mapping=template.texture.mapping;environment.texture.colorSpace=template.texture.colorSpace;environment.texture.generateMipmaps=false;
  const levels=Object.fromEntries(materials.map(({key})=>[key,1]));
  let current=studioColorFields.map(([key])=>new Color(colors[key])),tween,colorKey=studioColorKey(colors);
  const uniforms={};basis.forEach((map,i)=>{uniforms['map'+i]={value:map.texture};uniforms['tint'+i]={value:new Color()};});
  const material=new ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,blending:NoBlending,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:basis.map((_,i)=>`uniform sampler2D map${i};uniform vec3 tint${i};`).join('\n')+
      'varying vec2 vUv;void main(){vec3 color=vec3(0.);'+basis.map((_,i)=>`color+=texture2D(map${i},vUv).rgb*tint${i};`).join('')+'gl_FragColor=vec4(color,1.);}' });
  const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),quad=new Mesh(new PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
  function compose(){
    studioColorFields.forEach(([key],i)=>uniforms['tint'+i].value.copy(current[i]).multiplyScalar(i===0?1:levels[key]));
    const target=renderer.getRenderTarget(),xr=renderer.xr.enabled,viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
    try{renderer.xr.enabled=false;renderer.setRenderTarget(environment);renderer.setScissorTest(false);renderer.render(scene,camera);}
    finally{renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.xr.enabled=xr;}
  }
  compose();
  return {
    configure(value){const key=studioColorKey(value);if(key===colorKey)return false;
      current=studioColorFields.map(([k])=>new Color(value[k]));colorKey=key;tween=undefined;compose();return true;},
    transition(value,duration=.3){const key=studioColorKey(value);if(key===colorKey)return false;
      tween={from:current.map(c=>c.clone()),to:studioColorFields.map(([k])=>new Color(value[k])),elapsed:0,duration:Math.min(.3,Math.max(.001,duration))};colorKey=key;return true;},
    setPanelLevels(value){let changed=false;for(const {key} of materials){const next=value[key]??1;
      if(!Number.isFinite(next)||next<0)throw new Error('Invalid studio panel level.');
      if(next!==levels[key]){levels[key]=next;changed=true;}}
      if(changed)compose();return changed;},
    update(dt){if(!tween)return false;tween.elapsed+=Math.max(0,dt);const t=Math.min(1,tween.elapsed/tween.duration),blend=t*t*(3-2*t);
      current.forEach((c,i)=>c.copy(tween.from[i]).lerp(tween.to[i],blend));compose();if(t===1)tween=undefined;return true;},
    get panelLevels(){return {...levels};},get transitioning(){return !!tween;},get texture(){return environment.texture;},get generationCount(){return basis.length;},
    dispose(){environment.dispose();basis.forEach(map=>map.dispose());quad.geometry.dispose();material.dispose();geometry.dispose();materials.forEach(({material})=>material.dispose());pmrem.dispose();},
  };
}

export function createFaceMetal() {
  return new MeshPhysicalMaterial({
    color: '#dac5bf', metalness: 1, roughness: 0.24, flatShading: true,
    clearcoat: 0.45, clearcoatRoughness: 0.16,
  });
}
