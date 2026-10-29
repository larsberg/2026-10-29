import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasRecorder, recordingSize } from '../src/canvas-recorder.js';
import { createMarchAudio } from '../src/march-audio.js';
import { pure } from '@strudel/core';
import { defaultMeshSetup } from '../src/mesh-settings.js';

class Stream {
  constructor(tracks){this.tracks=tracks;}
  getTracks(){return this.tracks;}
  getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
  getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
}
const track=kind=>({kind,stopped:false,stop(){this.stopped=true;}});
class Recorder extends EventTarget {
  static isTypeSupported(type){return type.includes('webm');}
  constructor(stream,options){super();this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{const e=new Event('dataavailable');e.data=new Blob(['recorded frames + audio']);this.dispatchEvent(e);this.dispatchEvent(new Event('stop'));});}
}
function fixture(options={}){
  let time=0;const frames=[],videos=[],audioTracks=[],revoked=[],created=[];
  const canvas={width:2400,height:1600,captureStream(){}};
  const recorder=createCanvasRecorder({canvas,Recorder,Stream,now:()=>time,
    urls:{createObjectURL(blob){created.push(blob);return `blob:${created.length}`;},revokeObjectURL(url){revoked.push(url);}},
    makeCanvas:()=>({getContext:()=>({fillRect(){},drawImage(...args){frames.push(args);}}),captureStream:()=>{const t=track('video');videos.push(t);return new Stream([t]);}}),
    captureAudio:async()=>{const t=track('audio');audioTracks.push(t);return {stream:new Stream([t]),enabled:true,dispose(){t.stop();}};},...options});
  return {recorder,canvas,frames,videos,audioTracks,revoked,created,tick(dt=20){time+=dt;recorder.captureFrame();}};
}
test('recording fixes even dimensions, includes final chunks and releases only its own tracks',async()=>{
  assert.deepEqual(recordingSize(2401,1601),{width:1920,height:1280});
  assert.deepEqual(recordingSize(900,1600),{width:900,height:1600});
  const f=fixture();await f.recorder.start();f.tick();
  f.canvas.width=800;f.canvas.height=800;f.tick();
  assert.deepEqual(f.frames.at(-1).slice(1),[320,0,1280,1280]);
  const result=await f.recorder.stop();
  assert.equal(result.blob.size,23);assert.equal(result.width,1920);assert.equal(result.height,1280);
  assert.match(result.filename,/\.webm$/);assert.equal(result.audioEnabled,true);
  assert.ok([...f.videos,...f.audioTracks].every(t=>t.stopped));assert.equal(f.recorder.state.phase,'idle');
  await f.recorder.start({fps:30});f.tick(40);await f.recorder.stop();assert.deepEqual(f.revoked,['blob:1']);
  f.recorder.dispose();assert.deepEqual(f.revoked,['blob:1','blob:2']);
});
test('canceling audio unlock or closing during a recording releases all capture resources',async()=>{
  let resolve;const t=track('audio');
  const f=fixture({captureAudio:()=>new Promise(r=>{resolve=r;})});
  const starting=f.recorder.start();assert.equal(f.recorder.state.phase,'starting');await f.recorder.stop();
  resolve({stream:new Stream([t]),dispose(){t.stop();}});await starting;
  assert.equal(f.recorder.state.phase,'idle');assert.ok(t.stopped&&f.videos[0].stopped);assert.equal(f.created.length,0);f.recorder.dispose();
  const active=fixture();await active.recorder.start();active.recorder.dispose();await Promise.resolve();
  assert.ok([...active.videos,...active.audioTracks].every(t=>t.stopped));assert.equal(active.created.length,0);
});
test('an unsupported encoder leaves the recorder usable and exposes the error',async()=>{
  class Unsupported extends Recorder {static isTypeSupported(){return false;}}
  const f=fixture({Recorder:Unsupported});await assert.rejects(f.recorder.start(),/No supported/);
  assert.equal(f.recorder.state.phase,'idle');assert.match(f.recorder.state.error,/No supported/);
  assert.ok([...f.videos,...f.audioTracks].every(t=>t.stopped));f.recorder.dispose();
});
test('recording taps the limiter output without interrupting speakers, effects, or playback',async()=>{
  const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
  const node=()=>({connections:new Set(),connect(next){this.connections.add(next);return next;},disconnect(next){if(next)this.connections.delete(next);else this.connections.clear();},gain:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()});
  const limiter=node(),captureNodes=[];
  const context=new EventTarget();Object.assign(context,{state:'running',currentTime:0,destination:{},createGain:node,createDynamicsCompressor:node,createWaveShaper:()=>limiter,
    createMediaStreamDestination(){const n=node();n.stream=new Stream([track('audio')]);captureNodes.push(n);return n;},close(){this.state='closed';return Promise.resolve();}});
  const audio=createMarchAudio({pattern:pure({layer:'bass',note:48,gain:.5}),createContext:()=>context,
    createVoices:()=>({trigger(){},configure(){},stop(){},dispose(){}}),setTimer:()=>1,clearTimer(){}});
  audio.configure({...defaultMeshSetup().audio,enabled:true});audio.play();
  const output=await audio.createRecordingOutput();
  assert.ok(limiter.connections.has(context.destination));assert.ok(limiter.connections.has(captureNodes[0]));
  assert.equal(output.enabled,true);assert.equal(audio.playing,true);
  audio.pause();assert.equal(output.stream.getAudioTracks()[0].stopped,false);
  audio.play();output.dispose();assert.ok(limiter.connections.has(context.destination));assert.equal(audio.playing,true);
  assert.equal(output.stream.getAudioTracks()[0].stopped,true);assert.equal(limiter.connections.size,1);
  const final=await audio.createRecordingOutput();audio.dispose();assert.equal(final.stream.getAudioTracks()[0].stopped,true);
});
