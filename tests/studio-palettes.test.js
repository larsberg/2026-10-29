import test from 'node:test';
import assert from 'node:assert/strict';
import { studioPalettes, applyStudioPalette, matchingStudioPalette } from '../src/studio-palettes.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

test('all Blobby studio palettes preserve reflection settings and roundtrip their environment colors',()=>{
  assert.deepEqual(studioPalettes.map(p=>p.id),['copper-blue','glacier','solar','orchid','citrus','ember','ink','pearl']);
  const original=mergeMeshSetup(defaultMeshSetup(),{lighting:{environment:{rotation:35,intensity:1.7}}});
  for(const palette of studioPalettes){
    const lighting=applyStudioPalette(original.lighting,palette.id),saved=validateMeshSetup({...original,lighting});
    assert.equal(matchingStudioPalette(saved.lighting),palette.id);assert.equal(saved.lighting.environment.rotation,35);assert.equal(saved.lighting.environment.intensity,1.7);
    for(const [key,color] of Object.entries(palette.environment))assert.equal(saved.lighting.environment[key],color);
  }
  assert.equal(original.lighting.environment.backgroundColor,'#000000');
});
