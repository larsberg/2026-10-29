// One continuous beat position for physics and Strudel. Tempo edits preserve
// phase; switching to an unlocked AudioContext preserves it too.
export function createMarchClock({now=()=>performance.now()/1000,bpm=80}={}) {
  let clock=now,tempo=bpm,beat=0,anchor=clock(),running=false;
  const position=()=>beat+(running?Math.max(0,clock()-anchor)*tempo/60:0);
  function latch(){beat=position();anchor=clock();}
  return {
    get beat(){return position();},get bpm(){return tempo;},get running(){return running;},
    play(){if(!running){anchor=clock();running=true;}},
    pause(){latch();running=false;},
    restart(){beat=0;anchor=clock();},
    setTempo(value){latch();tempo=value;},
    useClock(next){latch();clock=next;anchor=clock();},
  };
}
