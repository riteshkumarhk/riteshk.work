import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import { CASE_LIMITS, caseSources, caseSourcePrompt, caseRevision, parseCaseResponse, applyCaseProposal, importFigmaSources } from './src/js/case-study-authoring.mjs';
const work = () => ({ id:'case', study:{enc:{wraps:{owner:'sealed-key'}},nativeDeck:{id:'deck'},slidesPublic:false,skim:{hook:'Keep'},blocks:[{type:'text',heading:'Original',body:'We interviewed 12 people.',src:'original.webp',editorName:'Custom'}, {type:'gallery',items:[{src:'full-quality.webp'}]}, {type:'media',encStub:true,locked:true,ct:'ciphertext'}]} });
const normalize = object => ({blocks:structuredClone(object.blocks)});
const state = {material:'We interviewed 12 people.',includeExisting:true};
const response = {outline:['Research'],questions:['What shipped?'],blocks:[{block:{type:'text',heading:'Research',body:'We interviewed 12 people.'},evidence:[{sourceId:'notes',quote:'We interviewed 12 people.'}]}]};
test('source file guard accepts 85 MB and retains file and workspace limits',async()=>{
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  function csgenAddPdf('),source.indexOf('  /* ---------- AI landing formatter'));
  for(const [size,existing,expected] of [[85,0,'reader reached'],[100,0,'reader reached'],[101,0,'100 MB'],[85,36,'120 MB']]) {
    const messages=[],input={click(){}},state={files:[{blob:{size:existing*1024*1024}}]};
    input.files=[{name:'large.pptx',size:size*1024*1024,arrayBuffer:async()=>{throw new Error('reader reached');}}];
    const context={CASE_LIMITS,data:{work:[{id:'case'}]},document:{createElement:()=>input},crypto:{randomUUID:()=> 'file'},csgenState:()=>state,pptxExtract(){},renderL2(){},csgenStatus:(_,message)=>messages.push(message)};
    runInNewContext(code,context);context.csgenAddPdf(0);await input.onchange();
    assert.match(messages.at(-1),new RegExp(expected));assert.equal(state.importing,false);
  }
});
test('PPTX bounds extracted XML without decompressing skipped media',async()=>{
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  async function pptxExtract('),source.indexOf('  function csgenAddPdf('));
  const context={Uint8Array,ensureUnzip:async()=>({unzipSync:(_bytes,{filter})=>{
    assert.equal(filter({name:'ppt/media/video.mp4',originalSize:200000000}),false);
    assert.equal(filter({name:'ppt/slides/slide1.xml',originalSize:1000}),true);
    assert.throws(()=>filter({name:'ppt/slides/slide2.xml',originalSize:30000001}),/XML size/);
    for(let index=0;index<3;index++)assert.equal(filter({name:'ppt/slides/slide.xml',originalSize:30000000}),true);
    assert.throws(()=>filter({name:'ppt/slides/slide.xml',originalSize:10000000}),/XML size/);
    for(let index=7;index<4000;index++)assert.equal(filter({name:'ppt/media/image.png',originalSize:1}),false);
    assert.throws(()=>filter({name:'ppt/media/image.png',originalSize:1}),/entry limits/);
    throw new Error('filter verified');
  }})};
  runInNewContext(code,context);
  await assert.rejects(context.pptxExtract(new ArrayBuffer(0)),/filter verified/);
});
test('sources exclude protected content and require real evidence',()=>{
  const sources=caseSources(work(),state);
  assert.equal(sources.length,3); assert.ok(!JSON.stringify(sources).includes('ciphertext'));assert.ok(!JSON.stringify(sources).includes('full-quality.webp'));
  assert.throws(()=>caseSources(work(),{links:'https://example.org'}),/not evidence/);
  assert.throws(()=>caseSources(work(),{sources:[{id:'pages',label:'Pages',text:'',images:Array(17).fill({})}]}),/16/);
});
test('citations and quantitative claims are checked, not repaired into approval',()=>{
  const current=work(),sources=caseSources(current,state);
  assert.equal(parseCaseResponse(JSON.stringify(response),sources,current,normalize).entries.length,1);
  assert.throws(()=>parseCaseResponse('{"blocks":[',sources,current,normalize),/Incomplete/);
  assert.throws(()=>parseCaseResponse(JSON.stringify(response).replace('sourceId":"notes','sourceId":"missing'),sources,current,normalize),/quotation/);
  const invalid=structuredClone(response);invalid.blocks[0].block.body='We achieved 92% growth.';
  assert.throws(()=>parseCaseResponse(JSON.stringify(invalid),sources,current,normalize),/number/);
  const malformed=structuredClone(response);malformed.blocks[0].block.body={html:'unsafe'};
  assert.throws(()=>parseCaseResponse(JSON.stringify(malformed),sources,current,normalize),/text/);
  const wrongList=structuredClone(response);wrongList.blocks[0].block.list=Array(13).fill('too many');
  assert.throws(()=>parseCaseResponse(JSON.stringify(wrongList),sources,current,normalize),/list/);
});
test('append and selective updates preserve metadata, media and protected content',()=>{
  const current=work(),before=JSON.stringify(current),proposal=parseCaseResponse(JSON.stringify(response),caseSources(current,state),current,normalize);
  const appended=applyCaseProposal(current,proposal,[{index:0,target:'append'}]);assert.equal(appended.blocks.length,4);
  const updated=applyCaseProposal(current,proposal,[{index:0,target:'0'}]);assert.equal(updated.blocks[0].src,'original.webp');assert.equal(updated.blocks[0].editorName,'Custom');
  assert.equal(updated.enc,current.study.enc);assert.equal(updated.nativeDeck,current.study.nativeDeck);assert.equal(updated.blocks[2],current.study.blocks[2]);assert.equal(JSON.stringify(current),before);
  assert.throws(()=>applyCaseProposal(current,proposal,[{index:0,target:'2'}]),/unprotected/);
  current.study.blocks[0].body='Concurrent edit';assert.throws(()=>applyCaseProposal(current,proposal,[{index:0,target:'append'}]),/changed/);
});
test('complete existing artifacts can be reused without rewriting media',()=>{
  const current=work(),sources=caseSources(current,state);sources.find(source=>source.id==='section-1').text='Original gallery';
  const draft={blocks:[{reuseSourceId:'section-1',evidence:[{sourceId:'section-1',quote:'Original gallery'}]}]};
  const proposal=parseCaseResponse(JSON.stringify(draft),sources,current,normalize);assert.deepEqual(proposal.entries[0].block,current.study.blocks[1]);assert.equal(proposal.revision,caseRevision(current));
});
test('Figma imports use ordered local images and explicitly exclude unsupported notes',()=>{
  const sources=importFigmaSources({schema:'rk-figma-slides-v1',title:'Deck',slides:[{text:'First',image:'data:image/png;base64,AA=='},{text:'Second'}]},'file');
  assert.equal(sources[1].label,'Deck / Slide 2');assert.match(sources[0].warning,/Speaker notes/);
  assert.throws(()=>importFigmaSources({schema:'rk-figma-slides-v1',slides:[{text:'First',image:'https://example.org/tracker'}]},'file'),/image/);
});
test('Figma exporter is read-only, ordered, skips hidden content and emits compatible packages',async()=>{
  const messages=[];
  const slide=(id,text,extra={})=>({type:'SLIDE',id,name:id,children:[{type:'TEXT',characters:text},{type:'TEXT',characters:'Hidden secret',visible:false}],exportAsync:async()=>new Uint8Array([0]),...extra});
  const figma={root:{name:'Fixture'},currentPage:{loadAsync:async()=>{},children:[{type:'SLIDE_GRID',children:[{children:[slide('second-name','First slide'),slide('skipped','Skipped',{isSkippedSlide:true})]},{children:[slide('first-name','Second slide')]}]}]},showUI(){},ui:{postMessage:message=>messages.push(message)},base64Encode:bytes=>Buffer.from(bytes).toString('base64')};
  const before=JSON.stringify(figma.currentPage);
  runInNewContext(readFileSync(new URL('./tools/figma-slides-source/code.js',import.meta.url),'utf8'),{figma,__html__:'',Uint8Array});
  await figma.ui.onmessage({type:'export'});
  const payload=messages.find(message=>message.type==='ready').payload;
  assert.deepEqual(Array.from(payload.slides,slide=>slide.text),['First slide','Second slide']);
  assert.equal(importFigmaSources(payload,'fixture').length,2);assert.equal(JSON.stringify(figma.currentPage),before);
  const manifest=JSON.parse(readFileSync(new URL('./tools/figma-slides-source/manifest.example.json',import.meta.url),'utf8'));assert.deepEqual(manifest.networkAccess.allowedDomains,['none']);
});

test('generation follows project identity and rejects stale, cancelled and invalid proposals',async()=>{
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const runCode=source.slice(source.indexOf('  async function csgenRun('),source.indexOf('  function csgenReview('));
  const promptCode=source.slice(source.indexOf('  function csgenSystem('),source.indexOf('  function csgenNormalize('));
  for (const scenario of ['reorder','stale','cancel','invalid','vision']) {
    const current=work(),other={id:'other',study:{blocks:[]}},before=JSON.stringify(current.study),state={...stateForRun(),sources:[]},messages=[];
    let release,reviewed,textCalls=0;
    if(scenario==='vision')state.sources=[{id:'visual',label:'Visual',text:'We interviewed 12 people.',images:[{src:'data:image/png;base64,AA==',mime:'image/png',b64:'AA=='}]}];
    const context={data:{work:[current,other]},clone:structuredClone,AbortController,caseSources,caseSourcePrompt,caseRevision,parseCaseResponse,csgenNormalize:normalize,csgenState:()=>state,aiHasKey:()=>true,aiCfg:()=>({}),renderL2(){},csgenPersist(){},csgenStatus:(_,message)=>messages.push(message),csgenReview:(target,proposal)=>{reviewed={target,proposal};},aiText:async(_cfg,_system,_user,options)=>{textCalls++;return new Promise(resolve=>{release=raw=>{if(scenario!=='invalid')options.validate(raw);resolve(raw);};});},aiVisionOnce:async()=>({ok:false,err:'Visuals unavailable'})};
    runInNewContext(promptCode+'\n'+runCode,context);
    const pending=context.csgenRun(0,false);
    if(scenario==='reorder')context.data.work.reverse();
    if(scenario==='stale')current.study.blocks[0].body='Concurrent edit';
    if(scenario==='cancel')state.controller.abort();
    if(release)release(scenario==='invalid'?'{}':JSON.stringify(response));
    await pending;
    if(scenario==='reorder'){assert.equal(reviewed.target,current);assert.equal(JSON.stringify(current.study),before);}
    else {assert.equal(reviewed,undefined);assert.equal(state.proposal,null);}
    if(scenario==='vision')assert.equal(textCalls,0);
    if(scenario!=='stale')assert.equal(JSON.stringify(current.study),before);
    assert.equal(other.study.blocks.length,0);assert.equal(state.running,false);
  }
});
function stateForRun(){return {material:'We interviewed 12 people.',includeExisting:false,consent:true,links:'',reference:'',tone:'senior',angle:'craft',instruction:'',history:[],proposal:null};}