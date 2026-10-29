import { instrumentGroups, instrumentFields } from './instrument-settings.js';

export function instrumentControlsMarkup() {
  return instrumentGroups.map(({ key, label, sounds }) => `
    <details class="material-group" ${['keys', 'melody'].includes(key) ? 'open' : ''}>
      <summary>${label}</summary>
      <div class="field-select"><label for="instrument-${key}-sound">Sound</label>
        <select id="instrument-${key}-sound" data-instrument="${key}" data-parameter="sound">${sounds.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select>
      </div>
      ${instrumentFields.map(([name,title,,min,max,step]) => {
        const id=`instrument-${key}-${name}`;
        return `<label class="slider-label" for="${id}">${title}<output></output></label><input id="${id}" data-instrument="${key}" data-parameter="${name}" type="range" min="${min}" max="${max}" step="${step}">`;
      }).join('')}
    </details>`).join('');
}

export function bindInstrumentControls(root, change) {
  const inputs=[...root.querySelectorAll('[data-instrument]')];
  for(const input of inputs) input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{
    if(!input.checkValidity()||input.value==='')return;
    const {instrument,parameter}=input.dataset;
    change({audio:{instruments:{[instrument]:{[parameter]:parameter==='sound'?input.value:Number(input.value)}}}});
  });
  return {
    set(settings){for(const input of inputs){
      const value=settings[input.dataset.instrument][input.dataset.parameter];
      if(document.activeElement!==input)input.value=String(value);
      const output=root.querySelector(`label[for="${input.id}"] output`);
      if(output)output.value=String(Number(value.toFixed(3)));
    }},
  };
}
