import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceSounds, renderReferenceVoice } from '../src/reference-instruments.js';

const rms = a => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
test('procedural reference instruments render finite, bounded audio with quiet endpoints',()=>{
  for(const sound of referenceSounds) for(const sampleRate of [22050,48000]) for(const decay of [.25,1,3]) {
    const samples=renderReferenceVoice({sound,hz:75,duration:.7,sampleRate,decay});
    assert.ok(samples.length>0&&samples.length<sampleRate*3);
    let peak=0;for(const x of samples){assert.ok(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));}
    assert.ok(peak>.01&&peak<1.8,`${sound}: ${peak}`);
    assert.ok(Math.abs(samples[0])<.001&&Math.abs(samples.at(-1))<.002);
  }
});
test('reference bass falls from about 88 to 75 Hz with the measured amplitude decay',()=>{
  const sampleRate=24000,samples=renderReferenceVoice({sound:'suuns-bass',hz:75,duration:1.45,sampleRate});
  const estimate=(start,end)=>{
    const crossings=[];
    for(let i=Math.floor(start*sampleRate);i<end*sampleRate;i++) if(samples[i-1]<0&&samples[i]>=0) crossings.push(i);
    return sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]);
  };
  assert.ok(estimate(.05,.2)>85&&estimate(.05,.2)<90);
  assert.ok(estimate(.7,1.1)>73&&estimate(.7,1.1)<76);
  assert.ok(rms(samples.slice(.8*sampleRate,1*sampleRate))<rms(samples.slice(.1*sampleRate,.3*sampleRate))*.25);
});
test('seed changes noisy articulations reproducibly and decay changes ringing time',()=>{
  const options={sound:'suuns-snare',sampleRate:24000,duration:1};
  const a=renderReferenceVoice({...options,seed:19}),b=renderReferenceVoice({...options,seed:19}),c=renderReferenceVoice({...options,seed:20});
  assert.deepEqual(a,b);assert.notDeepEqual(a,c);
  assert.equal(renderReferenceVoice({...options,decay:2}).length,a.length*2);
});
