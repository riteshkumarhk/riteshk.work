const terms = value => String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
const genericTerms = new Set(["senior", "designer", "design", "product", "ii", "the", "and", "of", "for", "corporation", "microsoft", "ai", "game", "growth", "windows"]);

export function journeyRoleKey(role) {
  return role.id || "role:" + JSON.stringify([role.role || "", role.org || ""]);
}

export function journeyEntryKey(chapter, entry, chapterIndex, entryIndex) {
  return JSON.stringify([chapter.id || chapterIndex, entry.id || entryIndex]);
}

export function journeyRoleIndex(paths, chapter, entry) {
  if (entry.pathId === "unassigned") return -2;
  if (entry.pathId === "separate") return -1;
  if (entry.pathId) return paths.findIndex(role => journeyRoleKey(role) === entry.pathId);
  const titleTerms = new Set(terms(entry.title));
  const chapterTerms = terms(chapter.name).filter(term => !genericTerms.has(term));
  const scores = paths.map(role => {
    const roleTerms = terms(role.role).filter(term => !genericTerms.has(term));
    const organization = new Set(terms(role.org));
    const titleScore = roleTerms.filter(term => titleTerms.has(term)).length;
    const organizationScore = chapterTerms.length > 1 && chapterTerms.every(term => organization.has(term)) ? 1 : 0;
    return titleScore * 2 + organizationScore;
  });
  const best = Math.max(0, ...scores);
  return best > 0 && scores.filter(score => score === best).length === 1 ? scores.indexOf(best) : -1;
}

export function journeyRows(data, { owner = false, preview = false } = {}) {
  const paths = data.path || [];
  const rows = paths.map((role, index) => ({ key: journeyRoleKey(role), role, index, stories: [] }));
  if (!data.journey?.enabled && !preview) return rows;
  (data.journey?.chapters || []).forEach((chapter, chapterIndex) => {
    let separate;
    (chapter.entries || []).forEach((entry, entryIndex) => {
      if (!entry || !(entry.title || entry.body || entry.period || entry.images?.some(image => image?.src))) return;
      if (!owner && !preview && entry.visibility !== "public") return;
      const story = { key: journeyEntryKey(chapter, entry, chapterIndex, entryIndex), chapter, entry, chapterIndex, entryIndex };
      const roleIndex = journeyRoleIndex(paths, chapter, entry);
      if (roleIndex === -2) return;
      if (roleIndex >= 0) rows[roleIndex].stories.push(story);
      else {
        if (!separate) {
          separate = { key: "chapter:" + (chapter.id || chapterIndex), role: { role: chapter.name || "Journey", years: "" }, stories: [] };
          rows.push(separate);
        }
        separate.stories.push(story);
      }
    });
  });
  return rows;
}