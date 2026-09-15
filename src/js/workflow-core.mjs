export const FLOW_NODE_WIDTH = 150;
export const FLOW_NODE_HEIGHT = 92;

export function snapFlowPosition(id, position, nodes, tolerance = 6) {
  const moving = nodes.find(node => node.id === id);
  if (!moving) return {position, guides:[]};
  const size = node => ({x:node.measured?.width || FLOW_NODE_WIDTH,y:node.measured?.height || FLOW_NODE_HEIGHT});
  const movingSize = size(moving), snapped = {...position}, guides = [];
  for (const axis of ['x','y']) {
    const across = axis === 'x' ? 'y' : 'x';
    let nearest;
    for (const node of nodes) {
      if (node.id === id || node.dragging || node.hidden) continue;
      const nodeSize = size(node);
      for (const fraction of [0,.5,1]) {
        const line = node.position[axis] + nodeSize[axis] * fraction;
        const delta = line - (position[axis] + movingSize[axis] * fraction);
        if (Math.abs(delta) <= tolerance && (!nearest || Math.abs(delta) < Math.abs(nearest.delta))) nearest = {delta,axis,line,position:line-movingSize[axis]*fraction,start:Math.min(position[across],node.position[across])-16,end:Math.max(position[across]+movingSize[across],node.position[across]+nodeSize[across])+16};
      }
    }
    if (nearest) { snapped[axis] = nearest.position; guides.push(nearest); }
  }
  return {position:snapped,guides};
}

export function flowCurve(source, target, sourcePort = 'r', targetPort = 'l', offsets, self = false) {
  const control = (point, other, port) => {
    const axis = port === 'l' || port === 'r' ? 'x' : 'y', direction = port === 'l' || port === 't' ? -1 : 1;
    const distance = (other[axis]-point[axis])*direction;
    const reach = distance >= 0 ? distance/2 : 10*Math.sqrt(-distance);
    return {...point,[axis]:point[axis]+direction*reach};
  };
  const controls = offsets ? {source:{x:source.x+offsets.source.x,y:source.y+offsets.source.y},target:{x:target.x+offsets.target.x,y:target.y+offsets.target.y}} : self ? {source:{x:source.x+100,y:source.y+110},target:{x:target.x-100,y:target.y+110}} : {source:control(source,target,sourcePort),target:control(target,source,targetPort)};
  const middle = {x:(source.x+3*controls.source.x+3*controls.target.x+target.x)/8,y:(source.y+3*controls.source.y+3*controls.target.y+target.y)/8};
  return {controls,middle,path:`M ${source.x},${source.y} C ${controls.source.x},${controls.source.y} ${controls.target.x},${controls.target.y} ${target.x},${target.y}`};
}

export function flowNode(id, title, x, y, number = '', note = '') {
  return {id, position:{x,y}, data:{title,number,note,outcome:false}};
}

export function flowEdge(source, target, sourceHandle = 'r', targetHandle = 'l', kind = 'main', label = '', route = 'elbow') {
  return {id:`${source}:${sourceHandle}-${target}:${targetHandle}`,source,target,sourceHandle,targetHandle,label,data:{kind,route}};
}

export function normalizeFlow(graph) {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Unsupported flow diagram.');
  const ids = new Set(), edgeIds = new Set();
  const text = value => typeof value === 'string' ? value : '';
  const nodes = graph.nodes.map(node => {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw new Error('Invalid flow step.');
    ids.add(node.id);
    return {id:node.id,position:{x:node.position.x,y:node.position.y},data:{title:text(node.data?.title),number:text(node.data?.number),note:text(node.data?.note),outcome:node.data?.outcome === true}};
  });
  const edges = graph.edges.map(edge => {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) throw new Error('Invalid flow connection.');
    edgeIds.add(edge.id);
    const port = (value, fallback) => ['l','r','t','b'].includes(value) ? value : fallback;
    let curve;
    if (edge.data?.curve != null) {
      if (!['source','target'].every(end => Number.isFinite(edge.data.curve[end]?.x) && Number.isFinite(edge.data.curve[end]?.y))) throw new Error('Invalid flow curve.');
      curve = Object.fromEntries(['source','target'].map(end => [end,{x:edge.data.curve[end].x,y:edge.data.curve[end].y}]));
    }
    return {id:edge.id,source:edge.source,target:edge.target,sourceHandle:port(edge.sourceHandle,'r'),targetHandle:port(edge.targetHandle,'l'),label:text(edge.label),data:{kind:['main','alternative','return'].includes(edge.data?.kind) ? edge.data.kind : 'main',route:edge.data?.route === 'curved' ? 'curved' : 'elbow',...(curve?{curve}:{})}};
  });
  return {version:1,nodes,edges};
}

export function graphFromWorkflow(block) {
  if (block.graph) return normalizeFlow(block.graph);
  const nodes = [], edges = [], groups = [];
  (block.items || []).forEach((item, index) => {
    const parts = String(item?.label || '').split('//').map(part => part.trim()).filter(Boolean);
    if (!parts.length) parts.push('');
    const group = parts.map((title, branch) => {
      const id = `step-${index + 1}-${branch + 1}`;
      nodes.push(flowNode(id,title,index * 230,branch * 180,String(index + 1).padStart(2,'0') + (parts.length > 1 ? String.fromCharCode(65 + branch) : ''),String(item?.note || '')));
      return id;
    });
    const previous = groups.at(-1) || [];
    previous.forEach(source => group.forEach(target => edges.push(flowEdge(source,target,'r','l',group.length > 1 || previous.length > 1 ? 'alternative' : 'main'))));
    groups.push(group);
  });
  if (groups.length && (block.flow === 'loop' || block.flow === 'cycle')) {
    const from = block.flow === 'cycle' ? Math.max(1,Math.min(groups.length,parseInt(block.loopFrom,10) || 1)) : 1;
    const to = block.flow === 'cycle' ? Math.max(from,Math.min(groups.length,parseInt(block.loopTo,10) || groups.length)) : groups.length;
    groups[to - 1].forEach(source => groups[from - 1].forEach(target => edges.push(flowEdge(source,target,'b','b','return'))));
  }
  return {version:1,nodes,edges};
}

export function workflowItems(block) {
  return block.graph ? graphFromWorkflow(block).nodes.map(node => ({label:node.data.title,note:node.data.note})) : block.items || [];
}