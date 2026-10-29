import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstrumentLevel } from '../src/instrument-level.js';

test('bass envelope lazily reads the latest 25 ms waveform and disconnects only its own tap',()=>{
  let level=.2;
  const connections=[],disconnects=[],analyser={getFloatTimeDomainData(out){out.fill(.9);out.fill(level,out.length-1103);},getFloatFrequencyData(){assert.fail('Unexpected spectrum analysis');},disconnect(){}};
  const tap=createInstrumentLevel({sampleRate:44100,createAnalyser:()=>analyser},{connect(node){connections.push(node);},disconnect(node){disconnects.push(node);}});
  assert.deepEqual(connections,[]);assert.ok(Math.abs(tap.readLevel()-.2)<1e-6);assert.deepEqual(connections,[analyser]);
  level=0;assert.equal(tap.readLevel(),0);tap.dispose();tap.dispose();assert.deepEqual(disconnects,[analyser]);assert.equal(tap.readLevel(),0);
});

test('unused channels create no analyser and unavailable analysis returns silence',()=>{
  const tap=createInstrumentLevel({createAnalyser(){assert.fail('Unexpected analyser');}},{disconnect(){assert.fail('Unexpected disconnect');}});
  tap.dispose();assert.equal(tap.readLevel(),0);
  assert.equal(createInstrumentLevel({},{}).readLevel(),0);
});
