import { availableStudies } from "./slide-merge-sections.mjs";

export const PREP_BRIEF_KEY = "rk:prep:brief";

export function prepareBrief(value = {}) {
  const text = (field, limit) => typeof value?.[field] === "string" ? value[field].slice(0, limit) : "";
  return {
    version:1, id:text("id", 120), updatedAt:Number(value?.updatedAt) || 0,
    company:text("company", 240), role:text("role", 240), url:text("url", 2000), jd:text("jd", 16000),
    level:["senior", "staff", "leader"].includes(value?.level) ? value.level : "staff",
    projectMode:value?.projectMode === "selected" ? "selected" : "all",
    projectIds:[...new Set((Array.isArray(value?.projectIds) ? value.projectIds : []).filter(id => typeof id === "string"))],
    includePrivate:value?.includePrivate === true, resumeSource:value?.resumeSource === "none" ? "none" : "site"
  };
}

export function prepareBriefWorks(value, data, projectIds = null) {
  const brief = prepareBrief(value);
  const works = (data?.work || []).filter(work => work && !work.encWork && (!work.hidden || brief.includePrivate) && (brief.projectMode === "all" || brief.projectIds.includes(work.id)) && (projectIds === null || projectIds.includes(work.id)));
  const eligible = new Map(availableStudies({work:works}).map(work => [work.id, work.blocks]));
  return works.filter(work => eligible.has(work.id)).map(work => ({...work, study:{...work.study, blocks:eligible.get(work.id)}}));
}