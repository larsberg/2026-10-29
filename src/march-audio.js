import { createMarchClock } from './march-clock.js';
import { silence } from '@strudel/core';
import { createHammockVoices } from './hammock-voices.js';
import { defaultMeshSetup } from './mesh-settings.js';
import { instrumentLevel } from './instrument-settings.js';

export function createMarchAudio({now=()=>performance.now()/1000,canPlay=()=>true,onStatus=()=>{},
  createContext=()=>new AudioContext(),createVoices=createHammockVoices,pattern=silence,
  setTimer=callback=>setInterval(callback,25),clearTimer=id=>clearInterval(id)}={}) {
  const clock=createMarchClock({now});
  let settings=defaultMeshSetup().audio,context,voices,master,compressor,limiter,timer,cursor=0,scheduled=0;
  let disposed=false,playing=false,operation=0,usingAudioClock=false,resumeSustains=false,hasPlayed=false,graphFault=false;
  let visualEvents=[],section;
  const delivered=new Map();
  const recordingOutputs=new Set();
  const active=()=>!disposed&&clock.running&&settings.enabled&&canPlay();
  function status(message){onStatus(message);}
  function stop(){operation++;playing=false;visualEvents=[];clearTimer(timer);timer=undefined;voices?.stop();
    if(master){master.gain.cancelScheduledValues(context.currentTime);master.gain.setValueAtTime(0,context.currentTime);}}
  function contextChanged(){
    if(context.state!=='running'){
      if(usingAudioClock){clock.useClock(now);usingAudioClock=false;}
      stop();if(active())status('Touch the scene to resume the beat.');
    }else if(active())start();
  }
  function initialize(){
    context=createContext();context.addEventListener('statechange',contextChanged);
    master=context.createGain();master.gain.value=0;
    compressor=context.createDynamicsCompressor();compressor.threshold.value=-14;compressor.knee.value=8;compressor.ratio.value=6;compressor.attack.value=.003;compressor.release.value=.12;
    limiter=context.createWaveShaper();limiter.curve=Float32Array.from({length:4097},(_,i)=>Math.max(-.85,Math.min(.85,i/2048-1)));
    master.connect(compressor).connect(limiter).connect(context.destination);voices=createVoices(context,master);
    const current=voices;
    current.loaded?.then(()=>{if(!disposed&&voices===current)start();},error=>{
      if(!disposed&&voices===current){stop();graphFault=true;status(`Audio: ${error.message}`);}
    });
  }
  function schedule(){
    if(!active()||context?.state!=='running'){stop();return;}
    try{
      const beat=clock.beat,bps=settings.bpm/60,end=beat+.16*bps;
      visualEvents=visualEvents.filter(event=>event.time>=context.currentTime-.2);
      if(cursor<beat-.1*bps){cursor=beat;voices.stop();resumeSustains=true;} // Never replay a backlog after a stall.
      if(end<=cursor)return;
      for(const hap of pattern.queryArc(cursor/4,end/4).sort((a,b)=>Number(a.whole.begin)-Number(b.whole.begin))){
        const held=!hap.hasOnset();
        if(held&&!(resumeSustains&&hap.value.sustained))continue;
        const onset=held?cursor:Number(hap.whole.begin)*4;
        const at=Math.max(context.currentTime+.004,context.currentTime+(onset-beat)/bps);
        voices.trigger({...hap.value,resumed:held,elapsedSeconds:held?(onset-Number(hap.whole.begin)*4)/bps:0},at,
          (Number(hap.whole.end)*4-onset)/bps,settings);scheduled++;
        const value=hap.value,group=['kick','snare','hat'].includes(value.layer)?'drums':value.layer;
        if(!held&&settings.volume>0&&settings[group]>0&&instrumentLevel(settings,value.layer)>0&&value.gain>0){
          const key=`${value.layer}:${value.note??value.s??'hit'}`,position=Number(hap.whole.begin);
          if(position>(delivered.get(key)??-1))visualEvents.push({...value,time:at,onset:position,beat:onset,key});
        }
      }
      cursor=end;resumeSustains=false;
      const currentSection=pattern.sectionAt?.(beat/4)?.name;
      const next=[pattern.title??'Strudel composition',currentSection].filter(Boolean).join(' · ');
      if(next!==section){section=next;status(next);}
    }catch(error){stop();status(`Beat stopped: ${error.message}`);}
  }
  function start(){
    if(!active()||context?.state!=='running'||playing||voices?.ready===false)return;
    if(!usingAudioClock){clock.useClock(()=>context.currentTime);usingAudioClock=true;}
    if(!hasPlayed){clock.restart();hasPlayed=true;}
    playing=true;cursor=clock.beat;resumeSustains=true;master.gain.setTargetAtTime(settings.volume,context.currentTime,.015);
    section=undefined;schedule();if(playing)timer=setTimer(schedule);
  }
  function retry(){
    if(pattern === silence){status('Strudel ready · no pattern loaded.');return Promise.resolve();}
    if(!active())return Promise.resolve();
    try{
      if(context?.state==='closed'||graphFault)releaseContext();
      if(!context)initialize();
      if(context.state==='running'){start();return Promise.resolve();}
      const token=operation;status('Touch the scene to start the beat.');
      // Resume on the gesture stack; statechange also handles browsers whose
      // resume promise stays pending after audio has actually started.
      return context.resume().then(()=>{if(token===operation&&!disposed)start();},error=>{if(token===operation&&!disposed)status(`Audio: ${error.message}`);});
    }catch(error){stop();status(`Audio: ${error.message}`);return Promise.resolve();}
  }
  function releaseContext(){
    stop();if(usingAudioClock){clock.useClock(now);usingAudioClock=false;}
    for(const output of [...recordingOutputs])output.dispose();
    const previous=context;previous?.removeEventListener('statechange',contextChanged);
    voices?.dispose();master?.disconnect();compressor?.disconnect();limiter?.disconnect();context=voices=master=compressor=limiter=undefined;graphFault=false;
    if(previous&&previous.state!=='closed')previous.close().catch(()=>{});
  }
  return {retry,
    async createRecordingOutput(){
      if(disposed)throw new Error('Audio has been closed.');
      if(context?.state==='closed'||graphFault)releaseContext();
      if(!context)initialize();
      const destination=context.createMediaStreamDestination(),source=limiter;
      source.connect(destination);
      let released=false;
      const output={stream:destination.stream,enabled:settings.enabled&&settings.volume>0,
        dispose(){if(released)return;released=true;source.disconnect(destination);destination.disconnect();
          destination.stream.getTracks().forEach(track=>track.stop());recordingOutputs.delete(output);}};
      recordingOutputs.add(output);
      try{if(context.state!=='running')await context.resume();return output;}
      catch(error){output.dispose();throw error;}
    },
    setPattern(next = silence) {
      if (!next || typeof next.queryArc !== 'function') throw new Error('Expected a Strudel pattern.');
      stop(); pattern = next; delivered.clear(); clock.restart();
      if (pattern === silence) releaseContext();
      return retry();
    },
    configure(value){
      const changed=['bpm','enabled','drums','bass','keys','melody'].some(key=>settings[key]!==value[key]);
      if(changed)stop();clock.setTempo(value.bpm);settings={...value};
      voices?.configure?.(settings);
      if(!settings.volume)visualEvents=[];
      if(!active()){stop();return;}
      if(master)master.gain.setTargetAtTime(settings.volume,context.currentTime,.015);
      void retry();
    },
    play(){if(disposed)return;clock.play();void retry();},
    pause(){clock.pause();stop();},
    restart(){stop();clock.restart();scheduled=0;delivered.clear();void retry();},
    drainEvents(){
      if(!playing||context?.state!=='running')return [];
      const ready=[],now=context.currentTime;
      visualEvents=visualEvents.filter(event=>{
        if(event.time>now)return true;
        if(event.time>=now-.2&&instrumentLevel(settings,event.layer)>0&&event.onset>(delivered.get(event.key)??-1)){
          ready.push(event);delivered.set(event.key,event.onset);
        }
        return false;
      });
      return ready;
    },
    get beat(){return clock.beat;},get playing(){return playing;},
    get audioTime(){return context?.currentTime;},
    readBass(){
      const audible=playing&&context?.state==='running'&&settings.volume>0&&settings.bass>0&&instrumentLevel(settings,'bass')>0;
      return {time:context?.currentTime??0,epoch:operation,playing:audible,level:audible?(voices?.bassLevel?.()??0)*settings.volume:0};
    },

    get diagnostics(){return {beat:clock.beat,bpm:clock.bpm,running:clock.running,playing,contextState:context?.state,scheduledEvents:scheduled,queuedEvents:visualEvents.length,activeVoices:voices?.activeVoices??0,instruments:voices?.diagnostics,section};},
    dispose(){if(disposed)return;disposed=true;clock.pause();releaseContext();},
  };
}
