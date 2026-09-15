import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {flowNode,flowEdge,normalizeFlow,graphFromWorkflow,workflowItems} from './src/js/workflow-core.mjs';

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