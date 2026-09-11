export function assertOwnerMediaResolved(value) {
  if (typeof value === "string" && /^rkenc:/i.test(value)) throw new Error("A protected media file could not be restored. Your saved content has not changed; check the connection and retry.");
  if (value && typeof value === "object") Object.values(value).forEach(assertOwnerMediaResolved);
}

export function hasStudioOwnerCopies(work) {
  const study = work?.study;
  return !!(study?.nativeDeckEnc?.wraps?.owner || study?.slidesOwnerEnc?.wraps?.owner || study?.authorSectionsEnc?.wraps?.owner);
}

export async function restoreStudioOwnerCopies(work, decrypt) {
  const restored = structuredClone(work), study = restored.study;
  if (!study) return restored;
  if (study.nativeDeckEnc) {
    const saved = await decrypt(study.nativeDeckEnc);
    if (saved?.version !== 1 || saved.caseStudyId !== work.id || !Array.isArray(saved.document?.slides)) throw new Error("The private slideshow copy is invalid");
    study.nativeDeckDocument = saved.document;
  }
  if (study.slidesOwnerEnc) {
    const slides = await decrypt(study.slidesOwnerEnc);
    if (!Array.isArray(slides)) throw new Error("The private slideshow copy is invalid");
    study.slides = slides; study.legacyDeckRestored = true;
  }
  if (study.authorSectionsEnc) {
    const saved = await decrypt(study.authorSectionsEnc);
    if (saved?.version !== 1 || saved.caseStudyId !== work.id || !Array.isArray(saved.blocks)) throw new Error("The private case-study copy is invalid");
    study.blocks = saved.blocks; study.authorSectionsRestored = true;
  }
  assertOwnerMediaResolved(restored);
  return restored;
}