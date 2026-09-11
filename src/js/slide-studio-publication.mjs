import { audienceComponent, deckVisibility, publicDeckPayload } from "./slide-merge-visibility.mjs";
import { createStudioDeck, STUDIO_DECK_SCHEMA } from "./slide-studio-deck.mjs";

export const NATIVE_AUDIENCE_SCHEMA = "rk-native-slide-audience";

export function nativePublicDeck(work) {
  const deck = work?.study?.nativeDeckPublic;
  return !work?.encWork && work?.study?.slidesPublic === true && deck?.schema === NATIVE_AUDIENCE_SCHEMA && deck.version === 1 && deck.rendererVersion === 1 && deck.visibility === "public" && Array.isArray(deck.slides) && deck.slides.length ? deck : null;
}

export async function prepareStudioPublication(draft, { loadDeck, encryptOwner, reviewedSources = false } = {}) {
  if (Object.hasOwn(draft || {}, "nativeDecksBackup")) throw new Error("A private backup cannot be published");
  const published = structuredClone(draft), jobs = [];
  delete published.adminGate;
  for (const work of published.work || []) {
    if (work.encWork || !work.study) continue;
    const study = work.study;
    if (study.nativeDeckDocument) throw new Error("An owner presentation copy cannot be published directly");
    if (study.nativeDeck) {
      const reference = study.nativeDeck;
      if (reference.schema !== STUDIO_DECK_SCHEMA || reference.caseStudyId !== work.id) throw new Error("The deck does not belong to this case study");
      const saved = await loadDeck(reference);
      const document = structuredClone(saved.document || createStudioDeck(work.title));
      document.title = work.title || document.title;
      const isPublic = deckVisibility(document) === "public";
      const audience = isPublic && document.slides.some(slide => !slide.hidden) ? publicDeckPayload(document, { reviewedSources, production: true }) : null;
      jobs.push(async () => {
        study.nativeDeckEnc = await encryptOwner({ version: 1, caseStudyId: work.id, document });
        if (audience) study.nativeDeckPublic = { schema: NATIVE_AUDIENCE_SCHEMA, ...audience };
        else delete study.nativeDeckPublic;
        study.slidesPublic = isPublic;
        delete study.nativeDeck; delete study.slides; delete study.slidesEnc; delete study.slidesOwnerEnc;
      });
    } else if (Object.hasOwn(study, "nativeDeck")) throw new Error("The native deck reference is invalid");
    else if (Array.isArray(study.slides)) {
      if (study.slides.some(slide => slide?.scene?.elements)) throw new Error("A native scene needs a supported deck reference");
      const slides = structuredClone(study.slides);
      if (study.slidesOwnerEnc && !study.legacyDeckRestored) {
        if (!study.slidesPublic) throw new Error("Unlock the slideshow before changing its published visibility");
      } else if (slides.length) {
        jobs.push(async () => {
          const encrypted = await encryptOwner(slides);
          if (study.slidesPublic) {
            study.slidesOwnerEnc = encrypted;
            study.slides = slides.filter(slide => !slide.hidden).map(audienceComponent);
            delete study.slidesEnc;
          } else {
            study.slidesEnc = encrypted;
            delete study.slides; delete study.slidesOwnerEnc;
          }
        });
      } else { delete study.slidesEnc; delete study.slidesOwnerEnc; }
    }
    if (Array.isArray(study.blocks) && study.blocks.some(block => block?.off)) {
      const blocks = structuredClone(study.blocks);
      jobs.push(async () => {
        study.authorSectionsEnc = await encryptOwner({ version: 1, caseStudyId: work.id, blocks });
        study.blocks = blocks.filter(block => !block?.off);
      });
    } else if (study.authorSectionsRestored) delete study.authorSectionsEnc;
    delete study.authorSectionsRestored; delete study.legacyDeckRestored;
  }
  for (const job of jobs) await job();
  return published;
}