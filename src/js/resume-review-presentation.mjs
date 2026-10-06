export const RESUME_REVIEW_CATEGORIES = Object.freeze([
  { id: "role", label: "Match this role", suggestionLabel: "Role-specific improvements", detail: "Requirements and the experience that supports them." },
  { id: "impact", label: "Prove your impact", suggestionLabel: "Show your impact", detail: "Outcomes and your contribution." },
  { id: "story", label: "Tell a clear career story", suggestionLabel: "Career clarity", detail: "Progression, transitions and consistency." },
  { id: "interview", label: "Prepare for scrutiny", suggestionLabel: "Interview preparation", detail: "Claims and context worth preparing to explain." },
  { id: "readability", label: "Make it easy to read", suggestionLabel: "Wording & readability", detail: "Clear writing and accessible information." },
  { id: "recommendations", label: "Review recommendations", suggestionLabel: "Recommendations", detail: "Saved findings without an assigned category." },
].map(category => Object.freeze(category)));

export function resumeFindingCategory(finding, review, index) {
  const declared = review?.kind === "ats" ? review.result?.fixes?.[index]?.category : finding.category;
  if (RESUME_REVIEW_CATEGORIES.some(category => category.id === declared)) return declared;
  if (review?.kind !== "ats") {
    if (["scope", "outcomes"].includes(finding.criterionId)) return "impact";
    if (finding.criterionId === "clarity") return "readability";
    if (review?.manifest?.requirements?.some(item => item.id === finding.criterionId)) return "role";
  }
  return "recommendations";
}

export function groupResumeFindings(items, review) {
  return RESUME_REVIEW_CATEGORIES.map(category => ({
    ...category,
    items: items.filter(item => resumeFindingCategory(item.finding, review, item.index) === category.id),
  })).filter(category => category.items.length);
}

export function resumeReviewSections(items, review) {
  const suggestions = [], assessments = [];
  for (const item of items) {
    const category = resumeFindingCategory(item.finding, review, item.index);
    const raw = review?.kind === "ats" ? review.result?.fixes?.[item.index] : item.finding;
    const cited = Boolean(raw?.anchor?.quote || raw?.anchor?.section || item.finding.fieldIds?.length ||
      review?.breakdown?.find(part => part.id === item.finding.criterionId)?.evidence?.length);
    const upfront = item.finding.priority === "high" || ["readability", "recommendations"].includes(category) ||
      (["role", "impact"].includes(category) && cited);
    (upfront ? suggestions : assessments).push(item);
  }
  return { suggestions: groupResumeFindings(suggestions, review), assessments: groupResumeFindings(assessments, review) };
}

export function resumeFindingTargets(finding, review, fields, proposal = null) {
  const cited = proposal ? [proposal.fieldId] : review?.kind === "ats" ? finding.fieldIds || [] :
    review?.breakdown?.find(part => part.id === finding.criterionId)?.evidence?.map(item => item.fieldId) || [];
  return [...new Set(cited)].filter(id => fields.some(field => field.id === id));
}

export function resumeContextPosition(stage, panel, anchor) {
  const inset = 12, gap = 12;
  const width = Math.min(340, Math.max(0, stage.width - inset * 2));
  const height = Math.min(panel.height, Math.max(0, stage.height - 84));
  let left = stage.width - width - inset, top = inset;
  if (anchor) {
    const right = anchor.right - stage.left + gap;
    const before = anchor.left - stage.left - width - gap;
    left = right + width <= stage.width - inset ? right : before >= inset ? before : left;
    top = anchor.top - stage.top;
    if (before < inset && right + width > stage.width - inset) top = anchor.bottom - stage.top + gap;
  }
  return { left: Math.max(inset, Math.min(left, stage.width - width - inset)),
    top: Math.max(inset, Math.min(top, stage.height - height - 72)), width,
    maxHeight: Math.max(0, stage.height - 84) };
}

export function observeResumeContext(panel, stage, getAnchor, extraScrollTarget) {
  const update = () => {
    const box = resumeContextPosition(stage.getBoundingClientRect(), panel.getBoundingClientRect(), getAnchor());
    for (const [key, value] of Object.entries(box)) panel.style[key] = value + "px";
  };
  const observer = new ResizeObserver(update);
  observer.observe(stage); observer.observe(panel);
  stage.ownerDocument.addEventListener("scroll", update, true);
  extraScrollTarget?.addEventListener("scroll", update, true);
  const view = stage.ownerDocument.defaultView;
  view.addEventListener("resize", update);
  update();
  return () => {
    observer.disconnect();
    stage.ownerDocument.removeEventListener("scroll", update, true);
    extraScrollTarget?.removeEventListener("scroll", update, true);
    view.removeEventListener("resize", update);
  };
}

export function observeResumeInfo(button, panel) {
  const view = panel.ownerDocument.defaultView;
  const update = () => {
    if (!panel.matches(":popover-open")) return;
    const anchor = button.getBoundingClientRect(), inset = 12;
    const width = Math.min(380, view.innerWidth - inset * 2);
    panel.style.width = width + "px";
    panel.style.maxHeight = view.innerHeight - inset * 2 + "px";
    const left = anchor.right + 12 + width <= view.innerWidth - inset ? anchor.right + 12 : anchor.left - width - 12;
    panel.style.left = Math.max(inset, Math.min(left, view.innerWidth - width - inset)) + "px";
    panel.style.top = Math.max(inset, Math.min(anchor.top, view.innerHeight - panel.offsetHeight - inset)) + "px";
  };
  panel.addEventListener("toggle", update);
  view.addEventListener("resize", update);
  panel.ownerDocument.addEventListener("scroll", update, true);
  const observer = new ResizeObserver(update);
  observer.observe(panel);
  return () => {
    observer.disconnect();
    panel.removeEventListener("toggle", update);
    view.removeEventListener("resize", update);
    panel.ownerDocument.removeEventListener("scroll", update, true);
  };
}
