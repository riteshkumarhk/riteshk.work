const terms = value => String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
const genericTerms = new Set(["senior", "designer", "design", "product", "ii", "the", "and", "of", "for", "corporation", "microsoft", "ai", "game", "growth", "windows"]);

export function journeyRoleKey(role) {
  return role.id || "role:" + JSON.stringify([role.role || "", role.org || ""]);
}

export function journeyEntryKey(chapter, entry, chapterIndex, entryIndex) {
  return JSON.stringify([chapter.id || chapterIndex, entry.id || entryIndex]);
}

export function journeyDateOrder(items, dateOf, currentOf = () => false) {
  const rank = item => {
    const text = String(dateOf(item) || '');
    const years = (text.match(/\b(?:18|19|20|21)\d{2}\b/g) || []).map(Number);
    const current = currentOf(item) || /\b(now|present|current|ongoing)\b/i.test(text);
    if (!years.length) return [current ? Infinity : -Infinity, -Infinity];
    return [current ? Infinity : Math.max(...years) - (/\bbefore\b/i.test(text) ? .5 : 0), Math.min(...years)];
  };
  return items.map((item, index) => ({ item, index, rank: rank(item) })).sort((left, right) => {
    for (const position of [0, 1]) {
      if (left.rank[position] !== right.rank[position]) return left.rank[position] > right.rank[position] ? -1 : 1;
    }
    return left.index - right.index;
  }).map(value => value.item);
}

export function journeyRoles(data) {
  const roles = (data.path || []).map((role, index) => ({ role, index }));
  return data.journey?.roleOrder === 'manual' ? roles : journeyDateOrder(roles, item => item.role.years, item => item.role.present);
}

function orderedStories(stories, role) {
  const sorted = journeyDateOrder(stories, story => story.entry.period);
  if (!Array.isArray(role?.storyOrder)) return sorted;
  const positions = new Map(role.storyOrder.map((key, index) => [key, index]));
  return sorted.sort((left, right) => (positions.get(left.key) ?? Infinity) - (positions.get(right.key) ?? Infinity));
}

export function journeyRoleStories(data, roleIndex) {
  const stories = (data.journey?.chapters || []).flatMap((chapter, chapterIndex) => (chapter.entries || []).map((entry, entryIndex) => ({
    key: journeyEntryKey(chapter, entry, chapterIndex, entryIndex), chapter, entry, chapterIndex, entryIndex
  }))).filter(story => journeyRoleIndex(data.path || [], story.chapter, story.entry) === roleIndex);
  return orderedStories(stories, data.path?.[roleIndex]);
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
  if (!data.journey?.enabled && !preview) return journeyRoles(data).map(item => rows[item.index]);
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
  rows.forEach(row => { row.stories = orderedStories(row.stories, row.role); });
  return journeyRoles(data).map(item => rows[item.index]).concat(rows.slice(paths.length));
}