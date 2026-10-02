export const AI_APPEARANCE_KEY = 'rk:ai:appearance';
export const AI_APPEARANCE_EVENT = 'rk:ai-appearance-change';
export const DEFAULT_AI_APPEARANCE = Object.freeze({style:'2d',orb:false});

export function readAiAppearance(view, onError = error => view.console.warn('AI appearance:',error)) {
  try {
    const raw=view.localStorage.getItem(AI_APPEARANCE_KEY);
    if (raw===null) return {...DEFAULT_AI_APPEARANCE};
    const value=JSON.parse(raw);
    if (!value || !['2d','3d'].includes(value.style) || typeof value.orb!=='boolean') throw new Error('Invalid saved appearance; using 2D without an orb.');
    return {style:value.style,orb:value.orb};
  } catch (error) {
    onError(error);
    return {...DEFAULT_AI_APPEARANCE};
  }
}

export function saveAiAppearance(view,value) {
  if (!value || !['2d','3d'].includes(value.style) || typeof value.orb!=='boolean') throw new Error('Choose a valid AI style and orb setting.');
  const appearance={style:value.style,orb:value.orb};
  view.localStorage.setItem(AI_APPEARANCE_KEY,JSON.stringify(appearance));
  view.dispatchEvent(new view.CustomEvent(AI_APPEARANCE_EVENT,{detail:appearance}));
  return appearance;
}
