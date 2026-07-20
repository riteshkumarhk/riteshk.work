/* Résumé Autofill — insertion engine (content script only).
   Tracks the field you last touched and writes text into it in a way that
   plays nicely with React/Vue/Angular forms (native setter + input/change). */
(function (root) {
  "use strict";

  var lastEditable = null;

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      var t = (el.type || "text").toLowerCase();
      var ok = ["text", "email", "tel", "url", "search", "number", ""];
      return ok.indexOf(t) !== -1 && !el.disabled && !el.readOnly;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function remember(el) {
    if (isEditable(el)) lastEditable = el;
  }

  document.addEventListener("focusin", function (e) {
    remember(e.target);
  }, true);
  document.addEventListener(
    "contextmenu",
    function (e) {
      remember(e.target);
    },
    true
  );

  function nativeSet(el, value) {
    var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function joinAppend(existing, text) {
    existing = (existing || "").replace(/\s+$/, "");
    return existing ? existing + "\n\n" + text : text;
  }

  /* mode: "replace" (default) | "append" */
  function insertInto(el, text, mode) {
    if (!el || !isEditable(el) || text == null) return false;
    try {
      el.focus();
    } catch (e) {}
    if (el.isContentEditable) {
      var val = mode === "append" ? joinAppend(el.innerText, text) : text;
      el.innerText = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    var value = mode === "append" ? joinAppend(el.value, text) : text;
    nativeSet(el, value);
    fire(el);
    return true;
  }

  /* Best current target: the remembered field if still on-page, else whatever is focused. */
  function target() {
    if (lastEditable && lastEditable.isConnected && isEditable(lastEditable)) return lastEditable;
    if (isEditable(document.activeElement)) return document.activeElement;
    return null;
  }

  /* Text used for keyword matching when auto-filling contact fields. */
  function fieldSignature(el) {
    var bits = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete")];
    var lbl = "";
    try {
      if (el.labels && el.labels.length) lbl = el.labels[0].innerText;
      else if (el.id) {
        var l = document.querySelector('label[for="' + (window.CSS ? CSS.escape(el.id) : el.id) + '"]');
        if (l) lbl = l.innerText;
      }
    } catch (e) {}
    bits.push(lbl);
    return bits
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  root.AFInsert = {
    insertInto: insertInto,
    target: target,
    isEditable: isEditable,
    fieldSignature: fieldSignature
  };
})(typeof self !== "undefined" ? self : this);
