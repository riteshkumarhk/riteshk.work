let pending;
export function loadWorkflow() {
  if (window.RKWorkflow) return Promise.resolve(window.RKWorkflow);
  if (pending) return pending;
  pending = Promise.all([
    ['link','/js/workflow.css?v=1.4'],
    ['script','/js/workflow.js?v=1.6']
  ].map(([tag,url])=>new Promise((resolve,reject)=>{
    const element=document.createElement(tag);
    if(tag==='link'){element.rel='stylesheet';element.href=url;}else element.src=url;
    const timer=setTimeout(()=>{element.remove();reject(new Error('Flow editor could not be loaded. Please retry.'));},20000);
    element.onload=()=>{clearTimeout(timer);resolve();};
    element.onerror=()=>{clearTimeout(timer);element.remove();reject(new Error('Flow editor could not be loaded. Please retry.'));};
    document.head.appendChild(element);
  }))).then(()=>window.RKWorkflow).catch(error=>{pending=null;throw error;});
  return pending;
}

export function enhanceWorkflows(root) {
  if (!root?.querySelector('rk-workflow')) return;
  loadWorkflow().catch(()=>{
    root.querySelectorAll('rk-workflow:not([data-ready])').forEach(element=>{
      if(element.querySelector('[data-flow-retry]'))return;
      const retry=document.createElement('button');
      retry.type='button';retry.className='pj__btn';retry.dataset.flowRetry='';retry.textContent='Load diagram';
      retry.onclick=()=>{retry.remove();enhanceWorkflows(root);};
      element.appendChild(retry);
    });
  });
}