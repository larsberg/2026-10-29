import { Color } from 'three';
import { studioColorKey } from './studio-palettes.js';

export function createStudioPaletteMotion({environment,scene,renderer,sun,hemisphere,spotlight,lighting}) {
  const colors=value=>[value.environment.backgroundColor,value.directional.color,value.hemisphere.skyColor,value.hemisphere.groundColor,value.spotlight?.color??value.directional.color].map(c=>new Color(c));
  let current=colors(lighting),from=current.map(c=>c.clone()),target=current.map(c=>c.clone()),elapsed=.3,key;
  const signature=value=>studioColorKey(value.environment)+colors(value).map(c=>c.getHexString()).join(',');
  key=signature(lighting);
  function apply(){scene.background.copy(current[0]);renderer?.setClearColor(current[0],1);if(scene.fog)scene.fog.color.copy(current[0]);sun.color.copy(current[1]);hemisphere.color.copy(current[2]);hemisphere.groundColor.copy(current[3]);spotlight?.color.copy(current[4]);}
  apply();
  return {
    configure(value){
      const next=signature(value);
      if(next!==key){from=current.map(c=>c.clone());target=colors(value);elapsed=0;key=next;environment.transition(value.environment,.3);}
      apply(); // Control refreshes must not snap an in-progress light fade.
    },
    update(dt){elapsed=Math.min(.3,elapsed+Math.max(0,dt));const t=elapsed/.3,blend=t*t*(3-2*t);
      current=from.map((c,i)=>c.clone().lerp(target[i],blend));environment.update(dt);apply();},
    get transitioning(){return elapsed<.3;},
  };
}
