export const WHITEBOARD_ROLES = [
  ['pm', 'PM'], ['engineer', 'Engineer'], ['accessibility', 'Accessibility specialist'],
  ['researcher', 'Researcher'], ['data', 'Data scientist'], ['client', 'Client'],
  ['customer', 'Customer'], ['domain', 'Domain specialist'], ['leadership', 'Leadership']
];

export function whiteboardSurpriseRoles(level) {
  return ['pm', 'engineer', ...(['leader', 'exec'].includes(level) ? ['leadership'] : [])];
}

export function whiteboardConversation(saved) {
  return {
    version: 1, started: saved?.started === true, surprises: saved?.surprises === true,
    thinking: saved?.thinking === true,
    role: WHITEBOARD_ROLES.some(([id]) => id === saved?.role?.id) ? {
      id: saved.role.id, origin: saved.role.origin === 'surprise' ? 'surprise' : 'requested'
    } : null,
    opportunity: saved?.opportunity && typeof saved.opportunity.turnId === 'string' &&
      typeof saved.opportunity.accepted === 'boolean' ? {...saved.opportunity} : null,
    memory: Array.isArray(saved?.memory) ? saved.memory.slice(-32) : []
  };
}

export function whiteboardConversationSystem(mode) {
  return [
    'This is a conversational whiteboard session, not a sequence of commands or mandatory interview stages. Understand intent in context, including negation, hypotheticals, corrections and mixed requests. Never require memorised phrases.',
    'Understand clarification, thinking aloud, uncertainty, disagreement, changing direction, requesting examples/hints, explaining trade-offs, accessibility, feasibility, validation, reflection and closing summaries. Answer an actual question before probing again. Acknowledge good reasoning without constant interrogation.',
    'Choose action think only for a current request for uninterrupted thinking: briefly acknowledge and stop asking questions. The clock continues. Pause only for an explicit request to pause the session clock. Recap means listen to their summary, NOT finish or score. Resume means return to exploration when explicitly requested. Otherwise respond. Never finish or score from a conversational action.',
    'When the candidate resumes talking after thinking, respond normally. Respect recap until they ask to explore again. No new challenges or surprise characters during thinking, recap or pause.',
    mode === 'coach'
      ? 'COACH: teach and scaffold when useful or requested without taking over. During role-play remain in character unless the candidate asks to step out for coaching or replay; then end the role, explain, and let them choose whether to practise again.'
      : 'MOCK: preserve candidate independence. Remain in character during role-play, do not supply the solution. Give a small hint only if requested and set assisted:true; save unsolicited evaluation for the final debrief.',
    'Role-play is optional multi-turn stakeholder collaboration in THIS exercise. Characters can be questioned, challenged or asked for evidence. Their opinion is not the correct answer. Announce every role change; label new fictional constraints as simulation additions, never retroactive established facts. Do not invent observations of a board.',
    'Use roleAction start with origin requested for a clear current candidate request. All allowedRoles are available manually, with no default selection. Leadership means strategy, organisational priorities, cross-team influence and executive trade-offs.',
    'Surprises are optional at meaningful conversational opportunities, NOT once per session and NOT on every message. You decide whether a stakeholder would genuinely help; keep the conversation unchanged when none would. Propose origin surprise only when enabled, in response to a new candidate turn after at least two candidate turns. The host independently accepts each proposed opportunity with 50% probability; do not roll dice yourself. The host may decline, so supply fallbackReply that naturally continues the CURRENT speaker with no hint of the proposed role or its fictional constraints. Do not repeatedly propose the same opportunity after a decline or skip; wait for a meaningful development in the discussion.',
    'Use only session automaticRoles for surprises: PM for framing/exploration (users, problem, goals, priorities); engineer for design/delivery (maturing flows, technical feasibility, dependencies, implementation). Timing follows conversational maturity, not elapsed minutes. For Head/Director or VP/Exec targets, actively consider Leadership for strategy/organisational decisions rather than defaulting to PM; it is still optional and subject to the same chance. Other roles remain manual only.',
    'A new opportunity may transition an active SURPRISE role into a different relevant role as the conversation evolves, such as PM to engineer. Explicitly announce the transition, carry forward decisions and unresolved questions, and label new fictional constraints. Never automatically replace a manually chosen role or restart the same active role. For a surprise proposal include opportunity:{stage:"framing"|"exploration"|"design"|"delivery"|"strategy",turnId:string,quote:string,reason:string}; cite the latest candidate turn with an exact short quote explaining why this is a meaningful new opportunity. No surprises during thinking, recap, pause, automatic observations, or a request to skip/end. Use end when asked to skip, leave, return to the interviewer or step out for coaching. Do not treat skips as failure. Keep otherwise.',
    'Host control events are authoritative and not candidate evidence. Never undo an End role-play event on an automatic turn. When a role is active, reply from that role unless ending it or announcing a permitted transition.',
    'Maintain concise source-linked memory updates only when useful: assumption, question, decision, or clarification. Each update needs the exact existing turnId and a verbatim quote from that turn. Candidate assumptions are never confirmed clarifications. Clarification is an explicit interviewer answer grounded in the original prompt, not a fictional stakeholder claim. Correct old entries using replaces (the old memory entry id); preserve the correction evidence. Questions may be resolved or retracted. Do not convert a question into a fact. The full transcript remains authoritative; memory is a derived aid.',
    'Return ONLY JSON: {"reply":string,"action":"respond"|"think"|"pause"|"recap"|"resume","roleAction":"keep"|"start"|"end","roleId":string|null,"origin":"requested"|"surprise"|null,"opportunity":object|null,"fallbackReply":string|null,"assisted":boolean,"memory":[{"kind":"assumption"|"question"|"decision"|"clarification","text":string,"turnId":string,"quote":string,"status":"open"|"resolved"|"retracted","replaces":string|null}]}. opportunity and fallbackReply are required only for a surprise proposal. At most 6 memory updates, 240 characters per text/quote/reason. Reply and fallbackReply are 1-3 short sentences, at most one question, or a brief acknowledgement. Do not expose JSON in the spoken reply.'
  ].join('\n');
}

export function applyWhiteboardReply(value, state, { turns, phase, candidateInput, automatic = false, level, random = Math.random }) {
  const fail = detail => { throw new Error('The conversational reply was invalid (' + detail + '). Your response is saved; retry the reply.'); };
  if (!value || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 4000) fail('reply');
  if (!['respond','think','pause','recap','resume'].includes(value.action)) fail('session action');
  if (!['keep','start','end'].includes(value.roleAction) || typeof value.assisted !== 'boolean') fail('role action');
  if (!candidateInput && value.action !== 'respond') fail('session action without a candidate request');
  const next = whiteboardConversation(state);
  let opportunity = null;
  next.thinking = value.action === 'think' || (!candidateInput && next.thinking);
  if (value.roleAction === 'start') {
    if (!WHITEBOARD_ROLES.some(([id]) => id === value.roleId)) fail('unknown role');
    if (!['requested','surprise'].includes(value.origin)) fail('role origin');
    if (phase !== 'working' || value.action !== 'respond' || state.thinking && value.origin === 'surprise') fail('role timing');
    if (value.origin === 'requested' && (!candidateInput || automatic)) fail('role without a candidate request');
    if (value.origin === 'surprise') {
      if (!state.surprises || state.role?.origin === 'requested' || state.role?.id === value.roleId ||
          !candidateInput || automatic || turns.filter(turn => turn.who === 'you').length < 2) fail('surprise not available');
      if (!whiteboardSurpriseRoles(level).includes(value.roleId)) fail('automatic role');
      const stages = {pm:['framing','exploration'],engineer:['design','delivery'],leadership:['strategy']};
      opportunity = value.opportunity;
      const latest = turns.findLast(turn => turn.who === 'you');
      if (!opportunity || !stages[value.roleId].includes(opportunity.stage) || opportunity.turnId !== latest?.id ||
          typeof opportunity.quote !== 'string' || !opportunity.quote.trim() || opportunity.quote.length > 240 || !latest.text.includes(opportunity.quote) ||
          typeof opportunity.reason !== 'string' || !opportunity.reason.trim() || opportunity.reason.length > 240) fail('opportunity evidence');
      if (typeof value.fallbackReply !== 'string' || !value.fallbackReply.trim() || value.fallbackReply.length > 4000) fail('opportunity fallback');
    }
    next.role = { id: value.roleId, origin: value.origin };
  } else if (value.roleAction === 'end') {
    if (!candidateInput || automatic) fail('role exit without a candidate request');
    next.role = null;
  }
  if (!Array.isArray(value.memory) || value.memory.length > 6) fail('memory updates');
  let memoryIndex = Math.max(0,...next.memory.map(item => Number(item.id?.replace('memory-','')) || 0));
  for (const item of value.memory) {
    const source = turns.find(turn => turn.id === item?.turnId);
    if (!source || !['assumption','question','decision','clarification'].includes(item.kind) ||
        !['open','resolved','retracted'].includes(item.status) ||
        typeof item.text !== 'string' || !item.text.trim() || item.text.length > 240 ||
        typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 240 || !source.text.includes(item.quote)) fail('memory evidence');
    if (item.kind === 'clarification' ? source.who !== 'int' || source.roleId : source.who !== 'you') fail('memory attribution');
    if (item.replaces != null) {
      if (!next.memory.some(old => old.id === item.replaces && old.kind === item.kind)) fail('memory correction');
      next.memory = next.memory.filter(old => old.id !== item.replaces);
    }
    next.memory = next.memory.filter(old => old.turnId !== item.turnId || old.kind !== item.kind || old.quote !== item.quote);
    next.memory.push({id:'memory-' + (++memoryIndex),kind:item.kind,text:item.text.trim(),turnId:item.turnId,quote:item.quote,status:item.status});
  }
  next.memory = next.memory.slice(-32);
  let reply = value.reply.trim();
  if (opportunity) {
    const previous = state.opportunity;
    if (previous?.turnId === opportunity.turnId && (previous.roleId !== value.roleId || previous.stage !== opportunity.stage)) fail('opportunity changed on retry');
    let accepted = previous?.turnId === opportunity.turnId ? previous.accepted : null;
    if (accepted === null) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) fail('opportunity probability');
      accepted = sample < 0.5;
    }
    next.opportunity = {...opportunity,roleId:value.roleId,accepted};
    if (!accepted) { next.role = state.role ? {...state.role} : null; reply = value.fallbackReply.trim(); }
  }
  return { conversation: next, reply, action: value.action, assisted: value.assisted };
}
