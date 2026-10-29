import { createInstrumentLevel } from './instrument-level.js';

// One persistent effect chain per part. Its notes share a filter, distortion,
// room and beat-synced delay; editing a slider also affects notes still ringing.
export function createInstrumentChannel(context, destination, impulse) {
  const input=context.createGain(),filter=context.createBiquadFilter(),drive=context.createWaveShaper();
  const output=context.createGain(),room=context.createConvolver(),reverb=context.createGain();
  const delay=context.createDelay(2.1),echo=context.createGain(),feedback=context.createGain(),damp=context.createBiquadFilter();
  const nodes=[input,filter,drive,output,room,reverb,delay,echo,feedback,damp];
  filter.type='lowpass';drive.oversample='2x';room.buffer=impulse;
  damp.type='lowpass';damp.frequency.value=Math.min(3200,context.sampleRate*.45);damp.Q.value=.45;
  input.connect(filter).connect(drive).connect(output).connect(destination);
  drive.connect(room).connect(reverb).connect(output);
  drive.connect(delay).connect(echo).connect(output);
  delay.connect(damp).connect(feedback).connect(delay);
  const level=createInstrumentLevel(context,output);
  let previous,previousVolume,previousTempo;
  function configure(settings,bpm,volume) {
    const first=!previous;
    const smooth=(param,value)=>{
      if(first)param.value=value;
      else {param.cancelScheduledValues(context.currentTime);param.setTargetAtTime(value,context.currentTime,.015);}
    };
    if(first||settings.level!==previous.level||volume!==previousVolume)smooth(output.gain,settings.level*volume);
    if(first||settings.cutoff!==previous.cutoff)smooth(filter.frequency,Math.min(settings.cutoff,context.sampleRate*.45));
    if(first||settings.resonance!==previous.resonance)smooth(filter.Q,settings.resonance);
    if(first||settings.reverb!==previous.reverb)smooth(reverb.gain,settings.reverb);
    if(first||settings.delay!==previous.delay)smooth(echo.gain,settings.delay);
    if(first||settings.feedback!==previous.feedback)smooth(feedback.gain,settings.feedback);
    if(first||settings.delayBeats!==previous.delayBeats||bpm!==previousTempo)smooth(delay.delayTime,settings.delayBeats*60/bpm);
    if(first||settings.drive!==previous.drive){
      const amount=1+settings.drive*12;
      drive.curve=settings.drive>0?Float32Array.from({length:2049},(_,i)=>Math.tanh((i/1024-1)*amount)/Math.tanh(amount)):null;
    }
    previous={...settings};previousVolume=volume;previousTempo=bpm;
  }
  return {input,configure,readLevel:level.readLevel,get settings(){return {...previous};},dispose(){level.dispose();for(const node of nodes)node.disconnect();}};
}
