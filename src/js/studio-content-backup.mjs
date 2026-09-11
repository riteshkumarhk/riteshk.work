import { studioDeckBackup } from "./slide-studio-deck.mjs";
import { restoreStudioOwnerCopies } from "./slide-studio-owner.mjs";

async function blobDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function completeStudioBackup(draft, { decryptOwner, readAsset, signal } = {}) {
  const copy = structuredClone(draft), files = new Map();
  const read = reference => {
    signal?.throwIfAborted();
    if (!files.has(reference)) files.set(reference, Promise.resolve().then(() => readAsset(reference)));
    return files.get(reference);
  };
  for (let index = 0; index < (copy.work || []).length; index++) {
    let work = copy.work[index];
    if (work.encWork) { work = await decryptOwner({ ...work.enc, iv: work.iv, ct: work.ct }); copy.work[index] = work; }
    const study = work.study;
    if (!study) continue;
    const protectedCopy = structuredClone(work);
    if (study.nativeDeck) delete protectedCopy.study.nativeDeckEnc;
    if (study.legacyDeckRestored) delete protectedCopy.study.slidesOwnerEnc;
    if (study.authorSectionsRestored) delete protectedCopy.study.authorSectionsEnc;
    const restored = await restoreStudioOwnerCopies(protectedCopy, decryptOwner);
    work.study = { ...study, ...restored.study };
    if (study.slidesEnc && !study.slides?.length) {
      work.study.slides = await decryptOwner(study.slidesEnc);
      delete work.study.slidesEnc;
    }
    if (Array.isArray(work.study.blocks)) for (let blockIndex = 0; blockIndex < work.study.blocks.length; blockIndex++) {
      const block = work.study.blocks[blockIndex];
      if (block?.encStub) work.study.blocks[blockIndex] = await decryptOwner({ ...study.enc, ...block });
      else if (block?.vaultBlock) {
        const original = JSON.parse(await (await read("vault:" + block.vaultBlock)).text());
        if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("A private section could not be backed up");
        work.study.blocks[blockIndex] = { ...original, locked: true, vault: true };
      }
    }
  }
  const backup = await studioDeckBackup(copy), encoded = new Map();
  const inline = reference => {
    if (/^data:/i.test(reference)) return Promise.resolve(reference);
    if (!encoded.has(reference)) encoded.set(reference, read(reference).then(blobDataUrl));
    return encoded.get(reference);
  };
  const visit = async (value, key = "") => {
    signal?.throwIfAborted();
    if (Array.isArray(value)) return Promise.all(value.map(item => visit(item, key)));
    if (value && typeof value === "object") {
      if (["slideEmbed", "pendingEmbed"].includes(key)) return value;
      for (const field of Object.keys(value)) value[field] = await visit(value[field], field);
      return value;
    }
    if (typeof value !== "string" || /^data:/i.test(value)) return value;
    if (/^rkenc:/i.test(value)) {
      const metadata = JSON.parse(atob(value.slice(6)));
      metadata.p = await inline(metadata.p);
      return "rkenc:" + btoa(JSON.stringify(metadata));
    }
    if (/^(body|desc|html|text|content|caption)$/i.test(key) && /<(?:img|video|audio|source)\b/i.test(value)) {
      const parsed = new DOMParser().parseFromString(value, "text/html");
      for (const node of parsed.querySelectorAll("img[src],video[src],video[poster],audio[src],source[src]")) {
        for (const attribute of ["src", "poster"]) if (node.hasAttribute(attribute)) node.setAttribute(attribute, await inline(node.getAttribute(attribute)));
      }
      return parsed.body.innerHTML;
    }
    const reference = /^(?:https?:\/\/|\/|\.\/|assets\/|fonts\/|vault:|rkenc:)/i.test(value);
    const media = /^(?:src|image|video|poster|cover|coverImage|avatar|beforeSrc|afterSrc|leftImg|rightImg|resume|dataURL|originalDataURL|sectionVideo|slideBackgroundVideo|uri)$/i.test(key) || /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|ogg|mp3|wav|woff2?|ttf|otf)(?:$|[?#])/i.test(value);
    if (reference && (media || value.startsWith("vault:"))) {
      if (/^(?:src|uri)$/i.test(key) && /^https:/i.test(value) && !/\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|ogg|mp3|wav|woff2?|ttf|otf)(?:$|[?#])/i.test(value) && !/(?:assets\/uploads|media\.riteshk\.work)/i.test(value)) return value;
      return inline(value);
    }
    return value;
  };
  return visit(backup);
}