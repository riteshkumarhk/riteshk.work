import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {flowNode,flowEdge,normalizeFlow,graphFromWorkflow,workflowItems,snapFlowPosition,snapFlowChanges,flowCurve} from './src/js/workflow-core.mjs';
import {getBezierPath,Position} from '@xyflow/react';

test('Workflow alignment snaps measured edges and centres within screen-scaled tolerance without mutating neighbors',()=>{
  const nodes=[{...flowNode('moving','Tall',0,0),measured:{width:150,height:140}},flowNode('anchor','Anchor',300,100)];
  const before=structuredClone(nodes);
  assert.equal(snapFlowPosition('moving',{x:295,y:400},nodes).position.x,300);
  const centre=snapFlowPosition('moving',{x:0,y:80},nodes);
  assert.equal(centre.position.y,76);
  assert.equal(centre.guides[0].line,146);
  assert.equal(snapFlowPosition('moving',{x:0,y:54},nodes).position.y,52);
  assert.equal(snapFlowPosition('moving',{x:290,y:400},nodes,6/2).position.x,290);
  assert.equal(snapFlowPosition('moving',{x:290,y:400},nodes,6/.5).position.x,300);
  assert.equal(snapFlowPosition('moving',{x:600,y:400},nodes).guides.length,0);
  assert.deepEqual(nodes,before);
});

test('Workflow equal-gap snapping uses measured edges between and beyond neighbors on both axes',()=>{
  const nodes=[flowNode('moving','Moving',0,0),flowNode('first','First',0,0),{...flowNode('second','Second',250,0),measured:{width:200,height:92}}];
  for(const [raw,expected] of [[{x:553,y:0},550],[{x:-247,y:0},-250]]){
    const result=snapFlowPosition('moving',raw,nodes);
    assert.equal(result.position.x,expected);
    assert.equal(result.guides.find(guide=>guide.axis==='x').kind,'spacing');
    assert.deepEqual(result.guides.find(guide=>guide.axis==='x').segments.map(([start,end])=>end-start),[100,100]);
  }
  nodes[2].position.x=650;
  assert.equal(snapFlowPosition('moving',{x:329,y:0},nodes).position.x,325);
  const column=[flowNode('moving','Moving',0,0),{...flowNode('first','Tall',0,0),measured:{width:150,height:140}},flowNode('second','Second',0,240)];
  assert.equal(snapFlowPosition('moving',{x:0,y:430},column).position.y,432);
  assert.equal(snapFlowPosition('moving',{x:1000,y:430},column).position.y,430,'Unrelated columns do not create spacing guides');
  assert.equal(snapFlowPosition('moving',{x:329,y:0},nodes,2).position.x,329);
  assert.equal(snapFlowPosition('moving',{x:329,y:0},nodes.map(node=>node.id==='second'?{...node,hidden:true}:node)).position.x,329);
});

test('Workflow group snapping preserves relative positions and prefers nearby geometry over grid',()=>{
  const nodes=[flowNode('first','First',0,0),flowNode('second','Second',230,31),flowNode('anchor','Anchor',500,500)];
  const changes=[{id:'first',type:'position',position:{x:105,y:111},dragging:true},{id:'second',type:'position',position:{x:335,y:142},dragging:true}];
  const before=structuredClone({nodes,changes}),result=snapFlowChanges(changes,nodes);
  assert.deepEqual(result.changes.map(change=>change.position),[{x:110,y:110},{x:340,y:141}]);
  assert.deepEqual({nodes,changes},before);
  assert.equal(snapFlowChanges([{id:'first',position:{x:497,y:200}}],nodes).changes[0].position.x,500,'Alignment wins over grid484');
  assert.deepEqual(snapFlowChanges(changes,nodes,6,0).changes,changes,'Grid can be bypassed independently by callers');
  assert.deepEqual(snapFlowChanges([],nodes),{changes:[],guides:[]});
});

test('Workflow curves preserve automatic React Flow geometry and persist endpoint-relative control points',()=>{
  const ports={l:Position.Left,r:Position.Right,t:Position.Top,b:Position.Bottom};
  for(const sourcePort of Object.keys(ports)) for(const targetPort of Object.keys(ports)){
    const result=flowCurve({x:150,y:46},{x:330,y:140},sourcePort,targetPort);
    const [path]=getBezierPath({sourceX:150,sourceY:46,targetX:330,targetY:140,sourcePosition:ports[sourcePort],targetPosition:ports[targetPort],curvature:.4});
    assert.deepEqual(result.path.match(/-?\d+(?:\.\d+)?/g).map(Number),path.match(/-?\d+(?:\.\d+)?/g).map(Number));
  }
  const curve={source:{x:80,y:-100},target:{x:-40,y:90}};
  const graph={version:1,nodes:[flowNode('a','Start',0,0),flowNode('b','End',300,0)],edges:[{...flowEdge('a','b','r','l','main','','curved'),data:{route:'curved',kind:'main',curve}}]};
  const saved=normalizeFlow(graph);
  assert.deepEqual(saved.edges[0].data.curve,curve);
  assert.notEqual(saved.edges[0].data.curve,curve);
  const original=flowCurve({x:150,y:46},{x:300,y:46},'r','l',curve),moved=flowCurve({x:170,y:76},{x:300,y:46},'r','l',curve);
  assert.deepEqual(moved.controls.source,{x:250,y:-24});
  assert.deepEqual(moved.controls.target,original.controls.target);
  assert.equal(flowCurve({x:0,y:0},{x:0,y:0},'b','b',null,true).controls.source.y,110);
  assert.throws(()=>normalizeFlow({...graph,edges:[{...graph.edges[0],data:{curve:{source:{x:Infinity,y:0},target:{x:0,y:0}}}}]}),/Invalid flow curve/);
});

test('Workflow fallback styles do not invalidate the shared presenter import',()=>{
  const stylesheet=readFileSync(new URL('./css/project.css',import.meta.url),'utf8');
  assert.match(stylesheet,/^\s*@import url\("\.\/deck-presenter\.css\?v=[^"]+"\);/);
});

test('legacy forks merge into subsequent steps and retain notes without mutating source',()=>{
  const block={type:'workflow',items:[{label:'Setup',note:'Original note'},{label:'Edge // Chrome'},{label:'Browse'}],caption:'Unchanged',locked:true};
  const before=structuredClone(block),graph=graphFromWorkflow(block);
  assert.equal(graph.nodes.length,4);
  assert.equal(graph.edges.length,4);
  assert.deepEqual(graph.nodes.map(node=>node.data.title),['Setup','Edge','Chrome','Browse']);
  assert.equal(graph.nodes[0].data.note,'Original note');
  assert.equal(graph.edges.filter(edge=>edge.target==='step-3-1').length,2);
  assert.deepEqual(block,before);
  assert.deepEqual(normalizeFlow(graph),graph);
});

test('legacy full and partial cycles retain explicit return connections',()=>{
  const items=[{label:'Start'},{label:'Review'},{label:'Refine'},{label:'Ship'}];
  for(const [flow,loopFrom,loopTo,source,target] of [['loop',null,null,'step-4-1','step-1-1'],['cycle',2,3,'step-3-1','step-2-1'],['cycle',9,9,'step-4-1','step-4-1']]){
    const graph=graphFromWorkflow({items,flow,loopFrom,loopTo});
    assert.equal(graph.edges.at(-1).data.kind,'return');
    assert.equal(graph.edges.at(-1).source,source);
    assert.equal(graph.edges.at(-1).target,target);
  }
  assert.deepEqual(graphFromWorkflow({items:[],flow:'cycle'}),{version:1,nodes:[],edges:[]});
});

test('graph storage preserves arbitrary branches and cycles but excludes renderer and selection state',()=>{
  const graph={version:1,nodes:[flowNode('a','<script>Text</script>',-180,40,'A','Keep'),flowNode('b','Choice',100,100),flowNode('c','Result',300,-100)],edges:[flowEdge('a','b'),flowEdge('a','c'),flowEdge('b','c'),flowEdge('c','a','t','t','return','Again','curved')]};
  graph.nodes[0].selected=true;graph.nodes[0].measured={width:150,height:92};
  const saved=normalizeFlow(graph);
  assert.equal(saved.nodes[0].data.title,'<script>Text</script>');
  assert.equal(saved.nodes[0].selected,undefined);
  assert.equal(saved.nodes[0].measured,undefined);
  assert.equal(saved.edges.length,4);
  assert.deepEqual(workflowItems({graph:saved,items:[{label:'Stale'}]}).map(item=>item.label),['<script>Text</script>','Choice','Result']);
  assert.throws(()=>normalizeFlow({...graph,version:2}),/Unsupported/);
  assert.throws(()=>normalizeFlow({...graph,nodes:[...graph.nodes,graph.nodes[0]]}),/Invalid flow step/);
  assert.throws(()=>normalizeFlow({...graph,edges:[flowEdge('a','missing')]}),/Invalid flow connection/);
  assert.throws(()=>normalizeFlow({...graph,nodes:[flowNode('bad','',Infinity,0)]}),/Invalid flow step/);
});

test('Studio Apply rejects stale sections and concealed content and leaves Cancel unchanged',async()=>{
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  async function editWorkflow('),source.indexOf('  function smeta('));
  for(const mode of ['apply','cancel','stale','replaced','concealed','sealed','save-failed']){
    const block={type:'workflow',caption:'Original',items:[{label:'Start',note:'Keep'}],locked:mode==='concealed',encStub:mode==='sealed'};
    const work={id:'case',study:{blocks:[block]}},data={work:[work]},before=structuredClone(block),calls=[];
    const graph=graphFromWorkflow({items:[{label:'Changed',note:'Keep'}]});
    const context={data,clone:structuredClone,workflowItems,root:{querySelector:()=>null},draftFull:mode==='save-failed',requestAnimationFrame:callback=>callback(),studySectionAccess:()=>({unlocked:false}),status:message=>calls.push(message),histPush:()=>calls.push('history'),apply:()=>calls.push('apply'),renderL2(){},refreshL2Preview(){},loadWorkflow:async()=>({open:async()=>{
      calls.push('open');
      if(mode==='stale')block.caption='Concurrent caption';
      if(mode==='replaced')work.study.blocks[0]=structuredClone(block);
      return mode==='cancel'?null:graph;
    }})};
    runInNewContext(code,context);const trigger={isConnected:true,disabled:false};await context.editWorkflow(0,0,trigger);
    assert.equal(trigger.disabled,false);
    if(['apply','save-failed'].includes(mode)){
      assert.deepEqual(block.graph,graph);assert.equal(block.caption,'Original');assert.deepEqual(calls.slice(0,3),['open','history','apply']);
      if(mode==='save-failed')assert.match(calls.at(-1),/could not save/);
    }else{
      assert.equal(block.graph,undefined);assert.ok(!calls.includes('apply'));
      if(mode==='concealed'||mode==='sealed'){assert.deepEqual(calls,[]);assert.deepEqual(block,before);}
      if(mode==='cancel')assert.deepEqual(block,before);
      if(mode==='stale'||mode==='replaced')assert.match(calls.at(-1),/section changed/);
    }
  }
});

test('Workflow hides optional library attribution through the supported React Flow option',()=>{
  const source=readFileSync(new URL('./src/js/workflow.jsx',import.meta.url),'utf8');
  assert.match(source,/proOptions=\{\{hideAttribution:true\}\}/);
});