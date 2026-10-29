import { Plane, Raycaster, Vector2, Vector3 } from 'three';

// Pointer events cover mouse, pen and touch. Empty-space gestures pass through
// to OrbitControls; a grabbed prop owns its pointers until release/cancel.
export function bindCafeGrab(element,{camera,controls,physics,onGrab=()=>{},windowTarget=window}){
  const raycaster=new Raycaster(),pointer=new Vector2(),plane=new Plane(),normal=new Vector3(),point=new Vector3();
  const pointers=new Map();let primary,depth=0,previousControls=true;
  const pickObjects=physics.entries.map(entry=>entry.object);
  function ray(event){const r=element.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
    camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
  function consume(event){event.preventDefault();event.stopImmediatePropagation();}
  function movePrimary(){const event=pointers.get(primary);if(event&&ray(event).intersectPlane(plane,point))physics.moveGrab(point);}
  function setDepth(next){depth=Math.max(1,Math.min(60,next));camera.getWorldDirection(normal);point.copy(camera.position).addScaledVector(normal,depth);plane.setFromNormalAndCoplanarPoint(normal,point);movePrimary();}
  function down(event){
    if(event.pointerType!=='touch'&&event.button!==0)return;
    if(physics.grabbed){pointers.set(event.pointerId,{clientX:event.clientX,clientY:event.clientY});element.setPointerCapture(event.pointerId);consume(event);return;}
    ray(event);const hit=raycaster.intersectObjects(pickObjects,true)[0];if(!hit)return;
    if(!physics.grab(hit.object.userData.cafeBody,hit.point))return;
    primary=event.pointerId;pointers.set(primary,{clientX:event.clientX,clientY:event.clientY});
    camera.getWorldDirection(normal);depth=hit.point.clone().sub(camera.position).dot(normal);plane.setFromNormalAndCoplanarPoint(normal,hit.point);
    previousControls=controls.enabled;controls.enabled=false;element.style.cursor='grabbing';element.setPointerCapture(primary);consume(event);onGrab();
  }
  function move(event){
    if(!pointers.has(event.pointerId))return;
    const previous=pointers.get(event.pointerId);pointers.set(event.pointerId,{clientX:event.clientX,clientY:event.clientY});consume(event);
    if(event.pointerId===primary)movePrimary();else setDepth(depth+(event.clientY-previous.clientY)*.025);
  }
  function finish(cancel=false){
    if(primary===undefined)return;
    physics.release(cancel);controls.enabled=previousControls;element.style.cursor='';primary=undefined;
    for(const id of pointers.keys())if(element.hasPointerCapture?.(id))element.releasePointerCapture(id);pointers.clear();
  }
  function up(event){if(!pointers.has(event.pointerId))return;consume(event);
    if(event.pointerId===primary)finish(event.type!=='pointerup');else{pointers.delete(event.pointerId);if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}
  }
  function wheel(event){if(primary===undefined)return;consume(event);setDepth(depth+event.deltaY*.012);}
  const blur=()=>finish(true),visibility=()=>{if(element.ownerDocument?.hidden)finish(true);};
  element.addEventListener('pointerdown',down,true);element.addEventListener('pointermove',move,true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(type,up,true);
  element.addEventListener('wheel',wheel,{capture:true,passive:false});windowTarget.addEventListener('blur',blur);element.ownerDocument?.addEventListener('visibilitychange',visibility);
  return {cancel:()=>finish(true),dispose(){finish(true);element.removeEventListener('pointerdown',down,true);element.removeEventListener('pointermove',move,true);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])element.removeEventListener(type,up,true);
    element.removeEventListener('wheel',wheel,true);windowTarget.removeEventListener('blur',blur);element.ownerDocument?.removeEventListener('visibilitychange',visibility);},
    get active(){return primary!==undefined;},
  };
}
