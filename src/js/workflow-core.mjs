export const FLOW_NODE_WIDTH = 150;
export const FLOW_NODE_HEIGHT = 92;

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
    return {id:edge.id,source:edge.source,target:edge.target,sourceHandle:port(edge.sourceHandle,'r'),targetHandle:port(edge.targetHandle,'l'),label:text(edge.label),data:{kind:['main','alternative','return'].includes(edge.data?.kind) ? edge.data.kind : 'main',route:edge.data?.route === 'curved' ? 'curved' : 'elbow'}};
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