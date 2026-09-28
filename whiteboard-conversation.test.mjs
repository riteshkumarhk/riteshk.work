import test from 'node:test';
import assert from 'node:assert/strict';
import { whiteboardConversation, whiteboardConversationSystem, whiteboardSurpriseRoles, applyWhiteboardReply } from './src/js/whiteboard-conversation.mjs';

const turns = [
  {id:'turn-1',who:'int',text:'The warehouse delay is five days.'},
  {id:'turn-2',who:'you',text:'I assume a first-time customer. Which refund method?'},
  {id:'turn-3',who:'you',text:'Actually, returning customers. I will show a range.'}
];
const response = extra => ({reply:'Take your time.',action:'respond',roleAction:'keep',roleId:null,origin:null,assisted:false,memory:[],...extra});
const apply = (extra, state = whiteboardConversation(), context = {}) => applyWhiteboardReply(response(extra),state,{turns,phase:'working',candidateInput:true,random:()=>0.1,...context});
const proposal = (roleId = 'engineer',stage = 'design') => ({
  roleAction:'start',roleId,origin:'surprise',
  opportunity:{stage,turnId:'turn-3',quote:'I will show a range.',reason:'The proposed flow now raises feasibility questions.'},
  fallbackReply:'What would the range help the customer understand?'
});

test('Whiteboard conversational actions distinguish silence, pause, recap and renewed exploration', () => {
  for (const action of ['respond','think','pause','recap','resume']) {
    const result = apply({action});
    assert.equal(result.action,action);
    assert.equal(result.conversation.thinking,action === 'think');
  }
  assert.equal(apply({},whiteboardConversation({thinking:true})).conversation.thinking,false);
  assert.throws(() => apply({action:'pause'},undefined,{candidateInput:false}),/without a candidate request/);
  assert.throws(() => apply({action:'finish'}),/session action/);
  assert.throws(() => apply({action:'score'}),/session action/);
});

test('Whiteboard role-play requires valid roles, opt-in and an appropriate moment', () => {
  const start = proposal();
  assert.throws(() => apply(start),/surprise not available/);
  const enabled = whiteboardConversation({surprises:true});
  assert.equal(apply(start,enabled).conversation.role.id,'engineer');
  assert.throws(() => apply(start,enabled,{candidateInput:false,automatic:true}),/surprise not available/);
  assert.throws(() => apply(start,enabled,{turns:turns.slice(0,2)}),/surprise not available/);
  for (const phase of ['briefing','paused','recap','debrief']) assert.throws(() => apply(start,enabled,{phase}),/role timing/);
  assert.throws(() => apply(start,{...enabled,thinking:true}),/role timing/);
  assert.throws(() => apply(start,{...enabled,role:{id:'pm',origin:'requested'}}),/surprise not available/);
  assert.throws(() => apply({...start,roleId:'invented'},enabled),/unknown role/);
  assert.throws(() => apply({...start,action:'think'},enabled),/role timing/);
});

test('Whiteboard explicit role requests and exits preserve context without assistance penalties', () => {
  const state = apply({roleAction:'start',roleId:'pm',origin:'requested'}).conversation;
  const next = apply({roleAction:'end'},state);
  assert.equal(next.conversation.role,null); assert.equal(next.assisted,false);
  assert.throws(() => apply({roleAction:'end'},state,{candidateInput:false,automatic:true}),/without a candidate request/);
  assert.equal(apply({roleAction:'start',roleId:'client',origin:'requested'},whiteboardConversation({thinking:true})).conversation.role.id,'client');
});

test('Whiteboard chance is exactly half per meaningful opportunity, not a session lottery', () => {
  const enabled = whiteboardConversation({surprises:true});
  for (const sample of [0,0.499999,0.5,0.999999]) {
    const outcome = apply(proposal(),enabled,{random:()=>sample});
    assert.equal(!!outcome.conversation.role,sample < 0.5);
    assert.equal(outcome.conversation.opportunity.accepted,sample < 0.5);
    if (sample >= 0.5) assert.equal(outcome.reply,proposal().fallbackReply);
  }
  let rolls=0;
  const denied=apply(proposal(),enabled,{random:()=>{rolls++;return 0.5;}}).conversation;
  const restored=whiteboardConversation(JSON.parse(JSON.stringify(denied)));
  const retried=apply(proposal(),restored,{random:()=>{throw new Error('Must not reroll');}});
  assert.equal(retried.conversation.role,null); assert.equal(rolls,1);
  const later=[...turns,{id:'turn-4',who:'you',text:'Now consider the payment provider dependency.'}];
  const next=apply({...proposal(),opportunity:{stage:'delivery',turnId:'turn-4',quote:'payment provider dependency',reason:'A new dependency affects delivery.'}},restored,{turns:later,random:()=>{rolls++;return 0.1;}});
  assert.equal(next.conversation.role.id,'engineer'); assert.equal(rolls,2);
  assert.throws(()=>apply({...proposal(),opportunity:{...proposal().opportunity,stage:'delivery'}},restored),/changed on retry/);
  let idleRolls=0;
  apply({},enabled,{random:()=>{idleRolls++;return 0;}});
  assert.equal(idleRolls,0,'Ordinary replies do not toss a coin');
});

test('Whiteboard automatic roles follow topic and leadership target, while manual roles remain open', () => {
  const enabled=whiteboardConversation({surprises:true});
  assert.deepEqual(whiteboardSurpriseRoles('staff'),['pm','engineer']);
  for(const level of ['leader','exec']) {
    assert.deepEqual(whiteboardSurpriseRoles(level),['pm','engineer','leadership']);
    assert.equal(apply(proposal('leadership','strategy'),enabled,{level}).conversation.role.id,'leadership');
  }
  assert.throws(()=>apply(proposal('leadership','strategy'),enabled,{level:'staff'}),/automatic role/);
  for(const role of ['client','researcher','accessibility','data','customer','domain']) assert.throws(()=>apply(proposal(role),enabled),/automatic role/);
  assert.throws(()=>apply(proposal('pm','delivery'),enabled),/opportunity evidence/);
  assert.throws(()=>apply(proposal('engineer','framing'),enabled),/opportunity evidence/);
  assert.equal(apply({roleAction:'start',roleId:'leadership',origin:'requested'},undefined,{random:()=>{throw new Error('Manual choices must not roll');}}).conversation.role.id,'leadership');
  const pm=apply(proposal('pm','framing'),enabled).conversation;
  const later=[...turns,{id:'turn-4',who:'you',text:'I will show a range.'}];
  const engineering={...proposal(),opportunity:{...proposal().opportunity,turnId:'turn-4'}};
  const declined=apply(engineering,pm,{turns:later,random:()=>0.8});
  assert.equal(declined.conversation.role.id,'pm'); assert.equal(declined.reply,engineering.fallbackReply);
  const changed=apply(engineering,pm,{turns:later});
  assert.equal(changed.conversation.role.id,'engineer');
  assert.throws(()=>apply(proposal('pm','framing'),pm),/surprise not available/);
  assert.throws(()=>apply(proposal(),{...enabled,role:{id:'pm',origin:'requested'}}),/surprise not available/);
});

test('Whiteboard opportunities need grounded current context and a valid non-role fallback', () => {
  const enabled=whiteboardConversation({surprises:true});
  for(const opportunity of [null,{...proposal().opportunity,turnId:'turn-2'},{...proposal().opportunity,quote:'invented'},{...proposal().opportunity,reason:''}]) {
    assert.throws(()=>apply({...proposal(),opportunity},enabled),/opportunity evidence/);
  }
  assert.throws(()=>apply({...proposal(),fallbackReply:''},enabled),/fallback/);
  for(const sample of [-0.1,1,NaN,Infinity]) assert.throws(()=>apply(proposal(),enabled,{random:()=>sample}),/probability/);
  assert.throws(()=>apply({...proposal(),memory:[{kind:'decision',turnId:'missing'}]},enabled,{random:()=>{throw new Error('Invalid envelopes must not roll');}}),/memory evidence/);
  assert.deepEqual(enabled,whiteboardConversation({surprises:true}));
});

test('Whiteboard memory is source-linked, corrected explicitly and never silently promoted to facts', () => {
  const assumption = {kind:'assumption',text:'First-time customer',turnId:'turn-2',quote:'I assume a first-time customer.',status:'open',replaces:null};
  const state = apply({memory:[assumption]}).conversation;
  const corrected = apply({memory:[{...assumption,text:'Returning customer',turnId:'turn-3',quote:'Actually, returning customers.',replaces:state.memory[0].id}]},state).conversation;
  assert.equal(state.memory[0].text,'First-time customer');
  assert.equal(corrected.memory.length,1);
  assert.equal(corrected.memory[0].text,'Returning customer');
  assert.throws(() => apply({memory:[{...assumption,kind:'clarification'}]}),/attribution/);
  assert.throws(() => apply({memory:[{...assumption,quote:'invented'}]}),/evidence/);
  assert.throws(() => apply({memory:[{...assumption,turnId:'turn-999'}]}),/evidence/);
  assert.throws(() => apply({memory:[{...assumption,replaces:'turn-999'}]}),/correction/);
  assert.throws(() => apply({memory:[{kind:'clarification',text:'Delay',turnId:'turn-1',quote:'five days',status:'open'}]},undefined,{turns:[{...turns[0],roleId:'engineer'}]}),/attribution/);
  assert.equal(apply({memory:[{kind:'clarification',text:'Delay',turnId:'turn-1',quote:'five days',status:'open'}]}).conversation.memory[0].kind,'clarification');
  const multiple = apply({memory:[{...assumption,quote:'I assume',text:'Stated assumption'},{...assumption,quote:'first-time customer',text:'Customer type'}]}).conversation.memory;
  assert.equal(multiple.length,2); assert.notEqual(multiple[0].id,multiple[1].id);
});

test('Whiteboard rejects malformed replies atomically and bounds derived memory', () => {
  const state = whiteboardConversation();
  for (const invalid of [{reply:''},{roleAction:'surprise'},{assisted:'false'},{memory:null},{memory:[null]}]) assert.throws(() => apply(invalid,state),/invalid/);
  assert.deepEqual(state,whiteboardConversation());
  const saved = whiteboardConversation({memory:Array.from({length:40},(_,i)=>({text:String(i)}))});
  assert.equal(saved.memory.length,32);
  assert.equal(whiteboardConversation({role:{id:'invalid'}}).role,null);
});

test('Whiteboard modes and natural intent contract remain explicit rather than command matching', () => {
  assert.match(whiteboardConversationSystem('coach'),/teach and scaffold/);
  assert.match(whiteboardConversationSystem('mock'),/preserve candidate independence/);
  assert.match(whiteboardConversationSystem('mock'),/negation, hypotheticals, corrections and mixed requests/);
  assert.match(whiteboardConversationSystem('mock'),/never retroactive established facts/);
  assert.match(whiteboardConversationSystem('mock'),/Do not treat skips as failure/);
  assert.match(whiteboardConversationSystem('mock'),/actively consider Leadership/);
  assert.match(whiteboardConversationSystem('mock'),/NOT once per session and NOT on every message/);
});
