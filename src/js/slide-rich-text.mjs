const allowed = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "BLOCKQUOTE", "S", "U"]);

export function notesHtml(value, document = globalThis.document, { format = "auto" } = {}) {
  const text = String(value ?? "");
  const template = document.createElement("template");
  if (format === "text" || (format !== "html" && !/<\/?(?:p|div|br|strong|b|em|i|ul|ol|li|blockquote|s|u)\b/i.test(text))) {
    template.textContent = text;
    const escaped = document.createElement("div"); escaped.textContent = text;
    return escaped.innerHTML.replace(/\r?\n/g, "<br>");
  }
  template.innerHTML = text;
  if (format === "html") {
    const comments = document.createTreeWalker(template.content, 128);
    let start;
    while (comments.nextNode()) {
      const comment = comments.currentNode;
      if (comment.data.trim() === "StartFragment") start = comment;
      if (start && comment.data.trim() === "EndFragment") {
        const range = document.createRange();
        range.setStartAfter(start); range.setEndBefore(comment);
        template.content.replaceChildren(range.cloneContents());
        break;
      }
    }
  }
  template.content.querySelectorAll("script,style,iframe,object,embed,svg,math,img,video,audio,link,meta").forEach(element => element.remove());
  for (const element of [...template.content.querySelectorAll("*")].reverse()) {
    if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; }
    const align = element.style.textAlign;
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (["left", "center", "right"].includes(align)) element.style.textAlign = align;
  }
  const blocks = new Set(["P", "DIV", "UL", "OL", "LI", "BLOCKQUOTE"]);
  for (const parent of [template.content, ...template.content.querySelectorAll("*")]) {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== 3 || !/^[\t\r\n ]+$/.test(node.textContent)) continue;
      if (blocks.has(node.previousSibling?.nodeName) || blocks.has(node.nextSibling?.nodeName)) node.remove();
    }
  }
  const output = document.createElement("div"); output.append(template.content);
  return output.textContent.trim() ? output.innerHTML : "";
}

export function notesText(value, document = globalThis.document) {
  const element = document.createElement("div"); element.innerHTML = notesHtml(value, document);
  element.querySelectorAll("p,div,li,blockquote,br").forEach(child => child.append("\n"));
  return element.textContent.trim();
}

export function serializedNotes(element) {
  const html = notesHtml(element.innerHTML, element.ownerDocument);
  if (!/<(?:p|div|strong|b|em|i|ul|ol|li|blockquote|s|u)\b|style=/i.test(html)) return element.innerText.replace(/\n$/, "");
  return html;
}

export function installRichNotes(element, { onChange, onImprove, onFormatChange, disabled = false }) {
  const doc = element.ownerDocument;
  element.contentEditable = String(!disabled); element.setAttribute("role", "textbox"); element.setAttribute("aria-multiline", "true"); element.setAttribute("aria-readonly", String(disabled)); element.tabIndex = disabled ? -1 : 0;
  const format = () => {
    if (!element.contains(doc.getSelection()?.anchorNode)) return;
    onFormatChange?.(Object.fromEntries(["bold", "italic", "insertUnorderedList", "insertOrderedList"].map(command => [command, doc.queryCommandState(command)])));
  };
  const input = () => { element.dataset.empty = String(!element.innerText.trim()); onChange?.(serializedNotes(element)); format(); };
  const paste = event => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html"), text = event.clipboardData.getData("text/plain");
    doc.execCommand("insertHTML", false, notesHtml(html || text, doc, { format: html ? "html" : "text" })); input();
  };
  const key = event => {
    if (!(event.ctrlKey || event.metaKey) || !["b", "i"].includes(event.key.toLowerCase())) return;
    event.preventDefault(); doc.execCommand(event.key.toLowerCase() === "b" ? "bold" : "italic"); input();
  };
  element.addEventListener("input", input); element.addEventListener("paste", paste); element.addEventListener("keydown", key);
  doc.addEventListener("selectionchange", format);
  return {
    set(value) { const next = notesHtml(value, doc); if (element.innerHTML !== next) element.innerHTML = next; element.dataset.empty = String(!element.textContent.trim()); },
    command(command) { element.focus(); doc.execCommand(command); input(); },
    improve: onImprove,
    dispose() { element.removeEventListener("input", input); element.removeEventListener("paste", paste); element.removeEventListener("keydown", key); doc.removeEventListener("selectionchange", format); }
  };
}