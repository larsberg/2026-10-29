import { noteToMidi } from '@strudel/core';
import { defaultInstruments, instrumentLevel } from './instrument-settings.js';
import { createInstrumentChannel } from './instrument-channel.js';
import { referenceSounds, renderReferenceVoice } from './reference-instruments.js';
import { rawSounds, createRawVoice } from './raw-voices.js';

// Procedural instruments only: oscillator partials, filtered noise and a
// synthesized room impulse. No recording, sample-bank URL or decoded audio.
export function createHammockVoices(context,destination){
  const voices=new Set(),channels=new Map(),defaults=defaultInstruments();let disposed=false;
  let seed=173;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2147483648-1;};
  const noise=context.createBuffer(1,context.sampleRate*2,context.sampleRate);
  const nd=noise.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=random();
  const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*.95),context.sampleRate);
  for(let c=0;c<2;c++){
    const data=impulse.getChannelData(c);let smooth=0;
    for(let i=0;i<data.length;i++){smooth=.75*smooth+.25*random();data[i]=smooth*Math.exp(-i/context.sampleRate*7)*Math.min(1,i/(context.sampleRate*.012));}
  }
  const wave=partials=>context.createPeriodicWave(new Float32Array(partials.length),Float32Array.from(partials));
  const waves={bass:wave([0,1,.12,.05,.015]),keys:wave([0,1,.36,.17,.21,.06,.03,.055,.015]),
    melody:wave([0,1,.18,.025,.014]),electric:wave([0,1,.08,.32,.025,.08])};
  const groupFor=layer=>['bass','keys','melody'].includes(layer)?layer:'drums';
  function configure(levels){
    for(const [layer,channel] of channels)channel.configure(levels.instruments?.[layer]??defaults[layer],levels.bpm??80,levels[groupFor(layer)]??0);
  }
  function channelFor(layer,levels){
    let channel=channels.get(layer);
    if(!channel){channel=createInstrumentChannel(context,destination,impulse);channels.set(layer,channel);}
    channel.configure(levels.instruments?.[layer]??defaults[layer],levels.bpm??80,levels[groupFor(layer)]??0);
    return channel;
  }
  function trigger(value,at,duration,levels){
    if(disposed)return;
    const pitched=['bass','keys','melody'].includes(value.layer),group=groupFor(value.layer),volume=levels[group]??0;
    if(!defaults[value.layer]||!(volume>0)||!(instrumentLevel(levels,value.layer)>0)||!(duration>0)||!(value.gain>0))return;
    const channel=channelFor(value.layer,levels),settings=levels.instruments?.[value.layer]??defaults[value.layer];
    const sound=settings.sound,decay=settings.decay;
    const nodes=[],sources=[];let ended=0,released=false;
    const voice={sources,cleanup};
    function cleanup(){if(released)return;released=true;for(const source of sources)source.onended=null;for(const node of nodes)node.disconnect();voices.delete(voice);}
    voices.add(voice);
    const node=n=>{nodes.push(n);return n;};
    const source=n=>{sources.push(n);node(n);n.onended=()=>{if(++ended===sources.length)cleanup();};return n;};
    const envelope=node(context.createGain()),gain=node(context.createGain());
    const scale={bass:.4,keys:.14,melody:.3,kick:.66,snare:.55,hat:.35};
    gain.gain.value=value.gain*(scale[value.layer]??.2);
    envelope.connect(gain).connect(channel.input);
    if(rawSounds.includes(sound)){
      gain.gain.value=value.gain*createRawVoice({context,value,sound,at,duration,bpm:levels.bpm??120,decay,envelope,node,source});
      return;
    }
    if(referenceSounds.includes(sound)){
      const frequency=note=>440*2**(((noteToMidi(note)+(Number(value.ctranspose)||0))-69)/12);
      const samples=renderReferenceVoice({sound,hz:pitched?(value.freq??frequency(value.note)):75,
        fromHz:value.glideFrom===undefined?undefined:frequency(value.glideFrom),duration,
        sampleRate:context.sampleRate,decay,seed:value.timbreSeed??173,vowel:value.vowel??0,
        open:value.s==='oh',detune:value.detune??0,glideTime:value.glideTime??.65});
      const buffer=context.createBuffer(1,samples.length,context.sampleRate);buffer.copyToChannel(samples,0);
      const player=source(context.createBufferSource());player.buffer=buffer;player.connect(envelope);
      gain.gain.value=value.gain;envelope.gain.value=1;player.start(at);
      return;
    }
    function osc(hz,length,target=envelope,amount=1,waveform='sine',tuned=false,detune=0){
      const o=source(context.createOscillator()),g=node(context.createGain());o.frequency.value=hz;g.gain.value=amount;
      if(typeof waveform==='string')o.type=waveform;else o.setPeriodicWave(waveform);
      if(tuned){
        const cents=Float32Array.from({length:48},(_,i)=>{const t=at+i/47*length;return Number(value.detune??-32)+detune+(value.wow??1)*(4*Math.sin(t*2*Math.PI*.31)+1.5*Math.sin(t*2*Math.PI*1.7));});
        o.detune.setValueCurveAtTime(cents,at,length);
        if(value.glideFrom!==undefined){
          const interval=noteToMidi(value.glideFrom)-noteToMidi(value.note);
          o.frequency.setValueAtTime(hz*2**(interval/12),at);
          o.frequency.exponentialRampToValueAtTime(hz,at+Math.min(length*.7,value.glideTime??.12));
        }
      }
      o.connect(g).connect(target);o.start(at);o.stop(at+length);return o;
    }
    function hiss(type,hz,length,amount=1,target=envelope){
      const n=source(context.createBufferSource()),filter=node(context.createBiquadFilter()),g=node(context.createGain());
      n.buffer=noise;n.loop=true;filter.type=type;filter.frequency.value=Math.min(context.sampleRate*.45,hz);filter.Q.value=.65;g.gain.value=amount;
      n.connect(filter).connect(g).connect(target);n.start(at);n.stop(at+length);
    }
    let length,attack=.003,body=.04,sustain=0,release=.1;
    if(pitched){
      const midi=noteToMidi(value.note)+(Number(value.ctranspose)||0),hz=value.freq??440*2**((midi-69)/12);
      if(!Number.isFinite(hz)){cleanup();throw new Error('Invalid pitched note.');}
      const bass=value.layer==='bass',melody=value.layer==='melody';
      const elapsed=value.elapsedSeconds??0,clip=Number(value.clip??1);
      length=Math.max(.06,(duration+elapsed)*clip*decay-elapsed)+(bass?.1:melody?.12:.22)*decay;
      attack=value.resumed?.012: bass?.014:melody?.022:.006;
      body=Math.min(length*.25,bass?.18:.09);sustain=bass?.7:melody?.55:.4;release=Math.min(length*.35,bass?.13:melody?.16:.24);
      let target=envelope;
      if(value.cutoff!==undefined){const filter=node(context.createBiquadFilter());filter.type='lowpass';filter.frequency.value=Math.min(context.sampleRate*.45,Number(value.cutoff));filter.Q.value=.45;filter.connect(envelope);target=filter;}
      if(sound==='original'){
        const waveform=['sine','triangle','sawtooth','square'].includes(value.s)?value.s:waves[value.layer];
        osc(hz,length,target,1,waveform,true);
        if(bass)osc(hz/2,length,target,midi===50?.25:.07,'sine',true);
        if(value.layer==='keys')hiss('bandpass',1800,Math.min(length,.025),.045,target);
        if(melody)hiss('bandpass',2100,length,.012,target);
      }else if(sound==='sub'){
        osc(hz,length,target,1,'sine',true);osc(hz/2,length,target,.16,'sine',true);
      }else if(sound==='reese'){
        osc(hz,length,target,.5,'sawtooth',true,-7);osc(hz,length,target,.5,'sawtooth',true,7);
      }else if(sound==='pluck'){
        attack=.002;body=.045;release=Math.min(.08,length*.3);sustain=.06;
        osc(hz,length,target,1,'triangle',true);osc(hz*2,length*.5,target,.12,'sine',true);
      }else if(sound==='electric'){
        sustain=.24;osc(hz,length,target,1,waves.electric,true);osc(hz*2.01,length*.45,target,.16,'sine',true);
      }else if(sound==='bell'){
        sustain=.08;attack=.002;body=.04;
        for(const [ratio,amount] of [[1,.7],[2.76,.23],[5.4,.08]])osc(hz*ratio,length,target,amount,'sine',true);
      }else if(sound==='pad'){
        attack=Math.min(.16,length*.2);body=attack+.04;sustain=.8;release=Math.min(.5,length*.45);
        osc(hz,length,target,.5,'triangle',true,-8);osc(hz,length,target,.5,'triangle',true,8);
      }else if(sound==='flute'){
        attack=.045;sustain=.7;osc(hz,length,target,1,'sine',true);osc(hz*2,length,target,.07,'sine',true);hiss('bandpass',1800,length,.025,target);
      }else if(sound==='lead'){
        attack=.008;sustain=.65;osc(hz,length,target,.8,'sawtooth',true);osc(hz/2,length,target,.15,'triangle',true);
      }else if(sound==='pulse'){
        attack=.004;body=Math.min(length*.3,.12);sustain=.55;release=Math.min(length*.2,.09);
        osc(hz,length,target,.55,'square',true);osc(hz,length,target,.5,'sine',true);
      }else if(sound==='guitar'){
        attack=.002;body=Math.min(length*.25,.055);sustain=.12;release=Math.min(length*.4,.18);
        osc(hz,length,target,.8,waves.electric,true);osc(hz*2,length*.45,target,.09,'triangle',true);
        hiss('bandpass',2400,Math.min(length,.018),.055,target);
      }else if(sound==='vowel'){
        attack=Math.min(.035,length*.2);body=Math.min(.12,length*.3);sustain=.6;release=Math.min(.18,length*.3);
        const formants=[[650,1100],[400,1800],[350,2200]][(Number(value.vowel)||0)%3];
        formants.forEach((frequency,i)=>{
          const formant=node(context.createBiquadFilter());formant.type='bandpass';formant.frequency.value=frequency;formant.Q.value=4;
          formant.connect(target);osc(hz,length,formant,i?.2:.45,'sawtooth',true);
        });
        osc(hz,length,target,.3,'sine',true);hiss('bandpass',2200,length,.018,target);
      }
    }else if(value.layer==='kick'){
      const [tail,start,end,sweep]=({original:[.3,128,48,.045],sub:[.65,110,42,.09],tight:[.17,155,62,.025],punch:[.32,185,52,.028]})[sound];
      length=tail*decay;const o=osc(start,length);o.frequency.setValueAtTime(start,at);o.frequency.exponentialRampToValueAtTime(end,at+Math.min(sweep,length*.6));
      hiss(sound==='punch'?'highpass':'lowpass',sound==='punch'?2200:900,Math.min(length,.02),sound==='sub'?.04:.14);
      if(sound==='punch')osc(88,length*.4,envelope,.18,'triangle');
    }else if(value.layer==='snare'){
      length=({original:.19,brush:.32,clap:.25,rim:.085})[sound]*decay;
      if(sound==='original'){hiss('bandpass',1900,length,1.3);osc(172,.13*decay,envelope,.24,'triangle');osc(335,.055*decay,envelope,.09);}
      if(sound==='brush'){hiss('highpass',1600,length,.8);osc(180,length*.4,envelope,.1);attack=.012;}
      if(sound==='rim'){osc(345,length,envelope,.7,'triangle');osc(780,length*.6,envelope,.3);hiss('bandpass',3500,length*.3,.25);}
      if(sound==='clap'){
        const flutter=node(context.createGain());flutter.connect(envelope);flutter.gain.setValueAtTime(0,at);
        for(const offset of [0,.012,.024]){flutter.gain.linearRampToValueAtTime(1,at+offset*decay+.001);flutter.gain.linearRampToValueAtTime(.12,at+(offset+.01)*decay);}
        flutter.gain.linearRampToValueAtTime(.7,at+.04*decay);hiss('bandpass',1500,length,1.4,flutter);
      }
    }else{
      length=(sound==='original'?(value.s==='oh'?.16:.065):({closed:.035,open:.32,metal:.12})[sound])*decay;
      hiss(sound==='original'?'bandpass':'highpass',sound==='open'?5500:sound==='closed'?7000:6200,length,sound==='metal'?.5:1);
      if(sound==='metal')for(const hz of [3200,4130,5270])osc(hz,length,envelope,.13,'square');
    }
    attack=Math.min(attack,length*.25);body=Math.min(body,length*.4);
    envelope.gain.setValueAtTime(0,at);envelope.gain.linearRampToValueAtTime(value.resumed?.65:1,at+attack);
    if(pitched){
      envelope.gain.exponentialRampToValueAtTime(sustain,at+Math.max(attack+.001,body));
      envelope.gain.linearRampToValueAtTime(sustain*.65,at+Math.max(body+.001,length-release));
    }
    envelope.gain.exponentialRampToValueAtTime(.0001,at+length-.003);envelope.gain.linearRampToValueAtTime(0,at+length);
  }
  function stop(){for(const voice of [...voices]){for(const source of voice.sources){try{source.stop();}catch{}}voice.cleanup();}for(const channel of channels.values())channel.dispose();channels.clear();}
  return {trigger,configure,stop,bassLevel(){return channels.get('bass')?.readLevel()??0;},get activeVoices(){return voices.size;},
    get diagnostics(){return {channels:channels.size,instruments:Object.fromEntries([...channels].map(([layer,channel])=>[layer,channel.settings]))};},
    dispose(){disposed=true;stop();}};
}
