import React,{useEffect,useRef,useState,useReducer} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,ReactFlowProvider,Handle,Position,ConnectionMode,MarkerType,MiniMap,Background,BackgroundVariant,BaseEdge,getBezierPath,getSmoothStepPath,getViewportForBounds,applyNodeChanges,addEdge,reconnectEdge,useReactFlow,useStore} from '@xyflow/react';
import {Monitor,Smartphone,MousePointer2,Maximize2,ZoomIn,ZoomOut,LocateFixed,Scan,X,ChevronLeft,ChevronRight,Plus,Undo2,Redo2,Trash2,Link} from 'lucide-react';
import {FLOW_NODE_WIDTH,FLOW_NODE_HEIGHT,flowNode,flowEdge,normalizeFlow,graphFromWorkflow} from './workflow-core.mjs';
import '@xyflow/react/dist/style.css';
import '../../css/workflow.css';

const clone=value=>structuredClone(value);
const ports={l:Position.Left,r:Position.Right,t:Position.Top,b:Position.Bottom};
const portNames={l:'Left',r:'Right',t:'Top',b:'Bottom'};
const motion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?0:180;
function IconButton({label,children,...props}){
  return <button type="button" className="wf-icon" title={label} aria-label={label} {...props}>{children}</button>;
}
function StepNode({data}){
  return <div className={`wf-step ${data.outcome?'is-outcome':''}`}>
    {Object.entries(ports).map(([id,position])=><Handle type="source" position={position} id={id} key={id} aria-label={`${data.title}: ${portNames[id]} connection`}/>)}
    {data.number&&<span className="wf-number">{data.number}</span>}
    <span className="wf-title">{data.title||'Untitled step'}</span>
    {data.note&&<span className="wf-note">{data.note}</span>}
  </div>;
}
function Connection(props){
  let [path,labelX,labelY]=props.data.route==='curved'?getBezierPath({...props,curvature:.4}):getSmoothStepPath({...props,borderRadius:22,offset:30});
  if(props.source===props.target){
    path=`M ${props.sourceX} ${props.sourceY} C ${props.sourceX+100} ${props.sourceY+110}, ${props.targetX-100} ${props.targetY+110}, ${props.targetX} ${props.targetY}`;
    labelX=(props.sourceX+props.targetX)/2;labelY=Math.max(props.sourceY,props.targetY)+85;
  }
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} label={props.label} labelX={labelX} labelY={labelY} labelStyle={{fill:'var(--text-dim)',fontFamily:'var(--sans)',fontSize:12}} labelBgStyle={{fill:'var(--bg)'}} labelBgPadding={[7,4]} labelBgBorderRadius={3}/>;
}
const nodeTypes={step:StepNode},edgeTypes={connection:Connection};
function fitDiagram(flow,host){
  if(!host||!flow.getNodes().length)return;
  const bounds=flow.getNodesBounds(flow.getNodes());
  let left=bounds.x,top=bounds.y,right=bounds.x+bounds.width,bottom=bounds.y+bounds.height;
  host.querySelectorAll('.react-flow__edge-path').forEach(path=>{
    const box=path.getBBox();
    left=Math.min(left,box.x);top=Math.min(top,box.y);right=Math.max(right,box.x+box.width);bottom=Math.max(bottom,box.y+box.height);
  });
  flow.setViewport(getViewportForBounds({x:left-24,y:top-24,width:right-left+48,height:bottom-top+48},host.clientWidth,host.clientHeight,.001,1,.08),{duration:0});
}
function Viewport({canvas,inline,fitted,start}){
  const flow=useReactFlow(),width=useStore(state=>state.width),height=useStore(state=>state.height);
  const dimensions=useStore(state=>Array.from(state.nodeLookup.values()).map(node=>`${node.measured?.width||0}:${node.measured?.height||0}`).join(','));
  const measured=useStore(state=>state.nodeLookup.size>0&&Array.from(state.nodeLookup.values()).every(node=>node.measured?.height>0));
  const initialized=useRef(false);
  useEffect(()=>{
    if(!flow.viewportInitialized||!width||!height)return;
    const frame=requestAnimationFrame(()=>{
      if(inline){if(fitted)fitDiagram(flow,canvas.current);else flow.setViewport(start,{duration:0});}
      else if(!initialized.current&&measured){
        fitDiagram(flow,canvas.current);initialized.current=true;
      }
    });
    return()=>cancelAnimationFrame(frame);
  },[inline,fitted,width,height,dimensions,measured,flow,start.x,start.y,start.zoom]);
  return null;
}
function GraphControls({canvas,start}){
  const flow=useReactFlow();
  return <div className="wf-controls" role="group" aria-label="Diagram navigation">
    <IconButton label="Zoom out" onClick={()=>flow.zoomOut({duration:motion()})}><ZoomOut size={18}/></IconButton>
    <IconButton label="Zoom in" onClick={()=>flow.zoomIn({duration:motion()})}><ZoomIn size={18}/></IconButton>
    <span className="wf-divider"/>
    <IconButton label="Fit diagram" onClick={()=>fitDiagram(flow,canvas.current)}><Scan size={18}/></IconButton>
    <IconButton label="Readable size" onClick={()=>flow.setViewport(start,{duration:motion()})}><LocateFixed size={18}/></IconButton>
  </div>;
}
function Diagram({doc,mode='web',selection,setSelection,change,checkpoint,flowRef,onTitleFocus,inlineFit=false}){
  const editor=mode==='editor',inline=mode==='inline',canvas=useRef(null),api=useRef(null);
  const minX=Math.min(0,...doc.nodes.map(node=>node.position.x)),maxX=Math.max(300,...doc.nodes.map(node=>node.position.x+FLOW_NODE_WIDTH));
  const start={x:24-minX*.92,y:26-(doc.nodes[0]?.position.y||0)*.92,zoom:.92};
  const selected=selection?.type==='node'?selection.id:null;
  const neighbors=new Set(selected?doc.edges.filter(edge=>edge.source===selected||edge.target===selected).flatMap(edge=>[edge.source,edge.target]):[]);
  const nodes=doc.nodes.map(node=>({...node,type:'step',width:FLOW_NODE_WIDTH,initialHeight:FLOW_NODE_HEIGHT,selected:selection?.type==='node'&&selection.id===node.id,className:!editor&&selected&&!neighbors.has(node.id)?'is-dimmed':''}));
  const edges=doc.edges.map(edge=>({...edge,type:'connection',selected:selection?.type==='edge'&&selection.id===edge.id,style:{stroke:edge.data.kind==='alternative'?'var(--text-dim)':'var(--accent)',strokeWidth:selection?.id===edge.id?2.5:1.5,opacity:!editor&&selected?(edge.source===selected||edge.target===selected?1:.15):.9,strokeDasharray:edge.data.kind==='return'?'5 5':undefined},markerEnd:{type:MarkerType.ArrowClosed,width:16,height:16,color:edge.data.kind==='alternative'?'var(--text-dim)':'var(--accent)'}}));
  return <div ref={canvas} className={`wf-diagram wf-diagram-${mode}`} data-inline-fit={inline?inlineFit:undefined} style={inline?{width:inlineFit?'100%':(maxX-minX)*.92+60,height:340}:undefined}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} minZoom={.001} maxZoom={2}
      nodesDraggable={editor} nodesConnectable={editor} edgesReconnectable={editor} deleteKeyCode={null} selectionOnDrag={false}
      panOnDrag={!inline} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={!inline} zoomOnDoubleClick={false} preventScrolling={false}
      defaultViewport={start} onInit={instance=>{api.current=instance;if(flowRef)flowRef.current=instance;}}
      onNodeClick={(_,node)=>setSelection({type:'node',id:node.id})} onEdgeClick={(_,edge)=>setSelection({type:'edge',id:edge.id})} onPaneClick={()=>setSelection(null)} onNodeDoubleClick={()=>editor&&onTitleFocus?.()}
      onNodeDragStart={()=>editor&&checkpoint()} onNodesChange={changes=>{if(editor){const edits=changes.filter(item=>item.type==='position');if(edits.length)change(current=>({...current,nodes:applyNodeChanges(edits,current.nodes)}),false);}}}
      onConnect={connection=>{if(editor)change(current=>({...current,edges:addEdge({...connection,id:crypto.randomUUID(),data:{kind:'alternative',route:'elbow'}},current.edges)}));}}
      onReconnectStart={()=>editor&&checkpoint()} onReconnect={(oldEdge,connection)=>editor&&change(current=>({...current,edges:reconnectEdge(oldEdge,connection,current.edges)}),false)}
      onConnectEnd={(event,state)=>{
        if(!editor||state.isValid||!state.fromNode||!state.fromHandle||!event.target.closest('.react-flow__pane'))return;
        const pointer=event.changedTouches?.[0]||event,point=api.current.screenToFlowPosition({x:pointer.clientX,y:pointer.clientY}),id=crypto.randomUUID();
        change(current=>({...current,nodes:[...current.nodes,flowNode(id,'New step',point.x,point.y-FLOW_NODE_HEIGHT/2)],edges:[...current.edges,{...flowEdge(state.fromNode.id,id,state.fromHandle.id,'l','alternative'),id:crypto.randomUUID()}]}));
        setSelection({type:'node',id});onTitleFocus?.();
      }}>
      {editor&&<Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line)"/>}
      <Viewport canvas={canvas} inline={inline} fitted={inlineFit} start={start}/>
      {!inline&&<GraphControls canvas={canvas} start={start}/>}
      {(editor||mode==='expanded')&&<MiniMap pannable zoomable position="bottom-right" nodeColor="var(--text-dim)" maskColor="var(--wf-map-mask)" ariaLabel="Diagram overview"/>}
    </ReactFlow>
  </div>;
}
function Summary({doc,selection}){
  const selected=doc.nodes.find(node=>selection?.type==='node'&&node.id===selection.id);
  return <span>{selected?<><strong>{selected.data.title||'Untitled step'}</strong><span className="wf-separator">/</span>{doc.edges.filter(edge=>edge.target===selected.id).length} in / {doc.edges.filter(edge=>edge.source===selected.id).length} out</>:<>{doc.nodes.length} steps / {doc.edges.length} connections</>}</span>;
}
function Outline({doc}){
  return <details className="wf-outline"><summary>Flow outline</summary><ol>{doc.nodes.map(node=><li key={node.id}><strong>{node.data.number&&`${node.data.number} `}{node.data.title||'Untitled step'}</strong>{node.data.note&&<p>{node.data.note}</p>}<ul>{doc.edges.filter(edge=>edge.source===node.id).map(edge=><li key={edge.id}>{edge.label?`${edge.label}: `:''}{edge.data.kind==='return'?'Return to ':'To '}{doc.nodes.find(target=>target.id===edge.target)?.data.title||'Untitled step'}</li>)}</ul></li>)}</ol></details>;
}
function Explorer({doc,selection,setSelection,onClose,title}){
  const dialog=useRef(null);
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close();},[]);
  return <dialog ref={dialog} className="rk-flow wf-explorer" aria-label="Expanded flow diagram" onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="wf-header"><h2>{title||'Flow'}</h2><IconButton label="Close expanded diagram" onClick={onClose}><X size={22}/></IconButton></header>
    <ReactFlowProvider><Diagram doc={doc} mode="expanded" selection={selection} setSelection={setSelection}/></ReactFlowProvider>
    <footer className="wf-footer"><Summary doc={doc} selection={selection}/></footer>
  </dialog>;
}
function useInlineDrag(scroll){
  const drag=useRef(null);
  const finish=event=>{delete event.currentTarget.dataset.dragging;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  return {
    onPointerDown:event=>{drag.current=null;if(event.pointerType==='mouse'&&event.button===0&&scroll.current.scrollWidth>scroll.current.clientWidth)drag.current={x:event.clientX,left:scroll.current.scrollLeft,moved:false};},
    onPointerMove:event=>{const state=drag.current;if(!state||event.pointerType!=='mouse'||!event.buttons)return;const distance=event.clientX-state.x;if(!state.moved&&Math.abs(distance)<6)return;state.moved=true;event.currentTarget.dataset.dragging='true';event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();scroll.current.scrollLeft=state.left-distance;},
    onPointerUp:finish,
    onPointerCancel:event=>{finish(event);drag.current=null;},
    onClickCapture:event=>{if(drag.current?.moved){event.preventDefault();event.stopPropagation();drag.current=null;}}
  };
}
function Reader({doc,title='',mobile:forcedMobile}){
  const [mobile,setMobile]=useState(!!forcedMobile),[expanded,setExpanded]=useState(false),[inlineFit,setInlineFit]=useState(false),[selection,setSelection]=useState(null);
  const root=useRef(null),scroll=useRef(null),readingPosition=useRef(0),trigger=useRef(null);
  const drag=useInlineDrag(scroll);
  useEffect(()=>{
    if(forcedMobile!==undefined){setMobile(forcedMobile);return;}
    const observer=new ResizeObserver(([entry])=>setMobile(entry.contentRect.width<620));
    observer.observe(root.current);return()=>observer.disconnect();
  },[forcedMobile]);
  const fit=()=>{if(!inlineFit)readingPosition.current=scroll.current.scrollLeft;setSelection(null);setInlineFit(true);};
  const readable=()=>{setInlineFit(false);requestAnimationFrame(()=>scroll.current?.scrollTo({left:readingPosition.current,behavior:'instant'}));};
  const close=()=>{setExpanded(false);requestAnimationFrame(()=>trigger.current?.focus());};
  return <div ref={root} className={`wf-reader ${mobile?'wf-mobile':''}`}>
    <div className="wf-band">
      <div className="wf-heading"><div className="wf-legend"><span><i/>Main path</span><span><i className="alternative"/>Alternative</span><span><i className="return"/>Return</span></div><button ref={trigger} type="button" className="wf-icon" title="Expand diagram" aria-label="Expand diagram" onClick={()=>setExpanded(true)}><Maximize2 size={18}/></button></div>
      {mobile?<div className="wf-inline-scroll" ref={scroll} {...drag} tabIndex={0} aria-label="Scrollable flow diagram"><ReactFlowProvider><Diagram doc={doc} mode="inline" inlineFit={inlineFit} selection={selection} setSelection={setSelection}/></ReactFlowProvider></div>:<ReactFlowProvider><Diagram doc={doc} selection={selection} setSelection={setSelection}/></ReactFlowProvider>}
      <footer className="wf-footer"><Summary doc={doc} selection={selection}/>{mobile&&<div className="wf-scroll-actions" role="group" aria-label="Inline diagram view"><IconButton label="Fit diagram" aria-pressed={inlineFit} onClick={fit}><Scan size={18}/></IconButton><IconButton label="Readable size" aria-pressed={!inlineFit} onClick={readable}><LocateFixed size={18}/></IconButton><IconButton label="Previous part of diagram" disabled={inlineFit} onClick={()=>scroll.current.scrollBy({left:-285,behavior:motion()?'smooth':'instant'})}><ChevronLeft size={18}/></IconButton><IconButton label="Next part of diagram" disabled={inlineFit} onClick={()=>scroll.current.scrollBy({left:285,behavior:motion()?'smooth':'instant'})}><ChevronRight size={18}/></IconButton></div>}</footer>
    </div>
    <Outline doc={doc}/>
    {expanded&&<Explorer doc={doc} title={title} selection={selection} setSelection={setSelection} onClose={close}/>}
  </div>;
}
function editReducer(state,action){
  if(action.type==='checkpoint')return {...state,past:[...state.past,clone(state.doc)].slice(-50),future:[]};
  if(action.type==='edit')return {doc:typeof action.next==='function'?action.next(state.doc):action.next,past:action.record?[...state.past,clone(state.doc)].slice(-50):state.past,future:[]};
  if(action.type==='undo'&&state.past.length)return {doc:state.past.at(-1),past:state.past.slice(0,-1),future:[state.doc,...state.future]};
  if(action.type==='redo'&&state.future.length)return {doc:state.future[0],past:[...state.past,state.doc],future:state.future.slice(1)};
  return state;
}
function Editor({doc,change,checkpoint,selection,setSelection,undo,redo,canUndo,canRedo}){
  const flow=useRef(null),title=useRef(null),canvas=useRef(null),editing=useRef(false),[connectTo,setConnectTo]=useState('');
  const selectedNode=doc.nodes.find(node=>selection?.type==='node'&&node.id===selection.id),selectedEdge=doc.edges.find(edge=>selection?.type==='edge'&&edge.id===selection.id);
  const focusTitle=()=>requestAnimationFrame(()=>{title.current?.focus();title.current?.select();});
  const add=()=>{if(!flow.current)return;const box=canvas.current.querySelector('.wf-diagram').getBoundingClientRect(),point=flow.current.screenToFlowPosition({x:box.left+box.width/2,y:box.top+box.height/2}),id=crypto.randomUUID();change(current=>({...current,nodes:[...current.nodes,flowNode(id,'New step',point.x,point.y)]}));setSelection({type:'node',id});focusTitle();};
  const remove=()=>{if(!selection)return;change(current=>selection.type==='node'?{...current,nodes:current.nodes.filter(node=>node.id!==selection.id),edges:current.edges.filter(edge=>edge.source!==selection.id&&edge.target!==selection.id)}:{...current,edges:current.edges.filter(edge=>edge.id!==selection.id)});setSelection(null);};
  const fieldStart=()=>{if(!editing.current){checkpoint();editing.current=true;}};
  const finish=()=>{editing.current=false;};
  const updateNode=patch=>{fieldStart();change(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,data:{...node.data,...patch}}:node)}),false);};
  const updateEdge=patch=>{fieldStart();change(current=>({...current,edges:current.edges.map(edge=>edge.id===selectedEdge.id?{...edge,...patch}:edge)}),false);};
  const connect=()=>{if(!selectedNode||!doc.nodes.some(node=>node.id===connectTo))return;const edge={...flowEdge(selectedNode.id,connectTo,'r',selectedNode.id===connectTo?'t':'l','alternative'),id:crypto.randomUUID()};change(current=>({...current,edges:addEdge(edge,current.edges)}));setSelection({type:'edge',id:edge.id});};
  return <section ref={canvas} className="wf-editor" onKeyDown={event=>{
    if(event.target.closest('input,textarea,select,[contenteditable]'))return;
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
  }}>
    <div className="wf-toolbar"><div className="wf-actions"><IconButton label="Undo" disabled={!canUndo} onClick={undo}><Undo2 size={18}/></IconButton><IconButton label="Redo" disabled={!canRedo} onClick={redo}><Redo2 size={18}/></IconButton><span className="wf-divider"/><button type="button" className="wf-command" onClick={add}><Plus size={17}/>Add step</button><IconButton label="Delete selection" disabled={!selection} onClick={remove}><Trash2 size={17}/></IconButton></div></div>
    <div className="wf-workspace"><ReactFlowProvider><Diagram doc={doc} mode="editor" selection={selection} setSelection={setSelection} change={change} checkpoint={checkpoint} flowRef={flow} onTitleFocus={focusTitle}/></ReactFlowProvider>
      <aside className="wf-inspector"><h2>{selectedNode?'Step':selectedEdge?'Connection':'Flow'}</h2>
        {selectedNode?<>
          <label>Title<textarea ref={title} aria-label="Step title" rows={3} value={selectedNode.data.title} onChange={event=>updateNode({title:event.target.value})} onBlur={finish}/></label>
          <label>Label<input type="text" aria-label="Step label" value={selectedNode.data.number} onChange={event=>updateNode({number:event.target.value})} onBlur={finish}/></label>
          <label>Note<textarea aria-label="Step note" rows={2} value={selectedNode.data.note} onChange={event=>updateNode({note:event.target.value})} onBlur={finish}/></label>
          <label className="wf-check"><input type="checkbox" checked={selectedNode.data.outcome} onChange={event=>{updateNode({outcome:event.target.checked});finish();}}/>Outcome</label>
          <h3>Connections</h3>{doc.edges.filter(edge=>edge.source===selectedNode.id||edge.target===selectedNode.id).map(edge=><button type="button" className="wf-row" key={edge.id} onClick={()=>setSelection({type:'edge',id:edge.id})}><span>{edge.source===selectedNode.id?'To':'From'}</span>{doc.nodes.find(node=>node.id===(edge.source===selectedNode.id?edge.target:edge.source))?.data.title||'Untitled step'}</button>)}
          <label>Connect to<select aria-label="Connect to step" value={connectTo} onChange={event=>setConnectTo(event.target.value)}><option value="">Choose a step</option>{doc.nodes.map(node=><option key={node.id} value={node.id}>{node.data.title||'Untitled step'}</option>)}</select></label><button type="button" className="wf-command" disabled={!doc.nodes.some(node=>node.id===connectTo)} onClick={connect}><Link size={16}/>Connect</button>
        </>:selectedEdge?<>
          <label>Label<input type="text" aria-label="Connection label" value={selectedEdge.label} onChange={event=>updateEdge({label:event.target.value})} onBlur={finish}/></label>
          <label>Path<select aria-label="Connection path" value={selectedEdge.data.kind} onChange={event=>{updateEdge({data:{...selectedEdge.data,kind:event.target.value}});finish();}}><option value="main">Main</option><option value="alternative">Alternative</option><option value="return">Return</option></select></label>
          <label>Connector<select aria-label="Connector shape" value={selectedEdge.data.route} onChange={event=>{updateEdge({data:{...selectedEdge.data,route:event.target.value}});finish();}}><option value="elbow">Rounded elbow</option><option value="curved">Curved</option></select></label>
          {['source','target'].map(field=><React.Fragment key={field}><label>{field==='source'?'From':'To'}<select aria-label={field==='source'?'Connection from':'Connection to'} value={selectedEdge[field]} onChange={event=>{updateEdge({[field]:event.target.value});finish();}}>{doc.nodes.map(node=><option key={node.id} value={node.id}>{node.data.title||'Untitled step'}</option>)}</select></label><label>{field==='source'?'From side':'To side'}<select aria-label={field==='source'?'Connection from side':'Connection to side'} value={selectedEdge[`${field}Handle`]} onChange={event=>{updateEdge({[`${field}Handle`]:event.target.value});finish();}}>{Object.entries(portNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></React.Fragment>)}
        </>:<>{doc.nodes.map(node=><button type="button" className="wf-row" key={node.id} onClick={()=>{setSelection({type:'node',id:node.id});flow.current?.setCenter(node.position.x+75,node.position.y+46,{zoom:1,duration:motion()});}}><span>{node.data.number||'--'}</span>{node.data.title||'Untitled step'}</button>)}</>}
      </aside>
    </div>
    <footer className="wf-footer"><Summary doc={doc} selection={selection}/></footer>
  </section>;
}
function FlowEditor({graph,title,onFinish}){
  const [state,dispatch]=useReducer(editReducer,{doc:clone(graph),past:[],future:[]}),[view,setView]=useState('editor'),[selection,setSelection]=useState(null),dialog=useRef(null);
  const change=(next,record=true)=>dispatch({type:'edit',next,record}),checkpoint=()=>dispatch({type:'checkpoint'});
  const undo=()=>{dispatch({type:'undo'});setSelection(null);},redo=()=>{dispatch({type:'redo'});setSelection(null);};
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close();},[]);
  return <dialog ref={dialog} className="rk-flow wf-editor-dialog" aria-label="Flow editor" onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();onFinish(null);}}>
    <header className="wf-header"><h2>{title||'Flow'}</h2><div className="wf-tabs" role="tablist" aria-label="Flow view">{[['editor','Editor',MousePointer2],['web','Web',Monitor],['mobile','Mobile',Smartphone]].map(([key,label,Icon])=><button type="button" key={key} role="tab" aria-selected={view===key} aria-controls="wf-view-panel" id={`wf-tab-${key}`} onClick={()=>{setView(key);setSelection(null);}} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const keys=['editor','web','mobile'],next=keys[(keys.indexOf(key)+(event.key==='ArrowLeft'?2:1))%3];setView(next);requestAnimationFrame(()=>document.getElementById(`wf-tab-${next}`)?.focus());}}}><Icon size={16}/>{label}</button>)}</div><IconButton label="Close flow editor" onClick={()=>onFinish(null)}><X size={20}/></IconButton></header>
    <div id="wf-view-panel" className={`wf-view wf-view-${view}`} role="tabpanel" aria-labelledby={`wf-tab-${view}`}>
      {view==='editor'?<Editor doc={state.doc} change={change} checkpoint={checkpoint} selection={selection} setSelection={setSelection} undo={undo} redo={redo} canUndo={!!state.past.length} canRedo={!!state.future.length}/>:<Reader key={view} doc={state.doc} title={title} mobile={view==='mobile'}/>}
    </div>
    <footer className="wf-apply"><button type="button" className="btn btn--ghost" onClick={()=>onFinish(null)}>Cancel</button><button type="button" className="btn btn--primary" onClick={()=>onFinish(normalizeFlow(state.doc))}>Apply flow</button></footer>
  </dialog>;
}
class WorkflowElement extends HTMLElement {
  static get observedAttributes(){return ['data-flow'];}
  connectedCallback(){this.renderFlow();}
  attributeChangedCallback(){if(this.isConnected)this.renderFlow();}
  disconnectedCallback(){queueMicrotask(()=>{if(!this.isConnected){this.root?.unmount();this.root=null;}});}
  renderFlow(){
    try{
      const value=JSON.parse(this.getAttribute('data-flow')),doc=graphFromWorkflow(value);
      if(!this.root){this.replaceChildren();this.classList.add('rk-flow');this.root=createRoot(this);}
      this.root.render(<Reader key={JSON.stringify(doc)} doc={doc} title={value.heading||''}/>);this.dataset.ready='';
    }catch(error){this.dataset.error='true';}
  }
}
if(!customElements.get('rk-workflow'))customElements.define('rk-workflow',WorkflowElement);
window.RKWorkflow={open({block,title,host=document.querySelector('.adm')||document.body}){
  const graph=graphFromWorkflow(block),trigger=document.activeElement,element=document.createElement('div');
  host.appendChild(element);const root=createRoot(element);
  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;root.unmount();element.remove();requestAnimationFrame(()=>{if(trigger?.isConnected)trigger.focus();});resolve(value);};
    root.render(<FlowEditor graph={graph} title={title} onFinish={finish}/>);
  });
}};