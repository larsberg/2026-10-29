import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { bindColliderDrag } from '../src/collider-drag.js';

test('body dragging captures the pointer and restores orbit state on up, cancel, blur, pause and rig rebuild',()=>{
  const element=new EventTarget(),blurTarget=new EventTarget(),documentTarget=new EventTarget();element.style={cursor:''};
  element.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200});let captured;
  element.setPointerCapture=id=>{captured=id;};element.hasPointerCapture=id=>captured===id;element.releasePointerCapture=()=>{captured=undefined;};
  const camera=new PerspectiveCamera(42,1,.1,100);camera.position.z=7;
  const controls={enabled:true},changes=[];let allowed=true,target,hit=true;
  const makeRig=()=>({dragging:false,pickCollider(){return hit?{link:{},point:new Vector3()}:null;},beginDrag(){this.dragging=true;return true;},moveDrag(value){target=value.clone();},endDrag(){this.dragging=false;}});
  let rig=makeRig();const drag=bindColliderDrag({element,camera,controls,getRig:()=>rig,canInteract:()=>allowed,onDragChange:value=>changes.push(value),blurTarget,documentTarget});
  const send=(type,patch={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{isPrimary:true,button:0,buttons:1,pointerId:1,clientX:100,clientY:100,...patch});element.dispatchEvent(event);return event;};
  try {
    assert.equal(send('pointerdown',{shiftKey:true}).defaultPrevented,false);assert.equal(drag.active,false);
    hit=false;send('pointerdown');assert.equal(controls.enabled,true);hit=true;
    send('pointerdown');assert.equal(drag.active,true);assert.equal(controls.enabled,false);assert.equal(captured,1);
    send('pointermove',{clientX:150});assert.ok(target.x>1);assert.ok(Math.abs(target.z)<1e-9);
    send('pointerup',{buttons:0});assert.equal(drag.active,false);assert.equal(controls.enabled,true);assert.equal(captured,undefined);
    for(const cancel of [()=>send('pointercancel'),()=>send('lostpointercapture'),()=>send('pointermove',{buttons:0}),()=>blurTarget.dispatchEvent(new Event('blur')),()=>{allowed=false;drag.update();allowed=true;},()=>{rig=makeRig();drag.update();},()=>{documentTarget.hidden=true;documentTarget.dispatchEvent(new Event('visibilitychange'));documentTarget.hidden=false;}]){
      send('pointerdown');cancel();assert.equal(drag.active,false);assert.equal(controls.enabled,true);assert.equal(changes.at(-1),false);
    }
    send('pointerdown');drag.dispose();assert.equal(drag.active,false);assert.equal(controls.enabled,true);
  }finally{drag.dispose();}
});
