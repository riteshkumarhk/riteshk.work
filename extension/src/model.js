/* Résumé Autofill — data model + storage keys (plain script, shared by all contexts). */
(function (root) {
  "use strict";

  var KEYS = {
    DATA: "af_data", // local: full JSON string (source of truth + offline copy)
    SYNC_META: "af_meta", // sync: { chunks, ts }
    SYNC_CHUNK: "af_c_", // sync: chunk-key prefix
    AI: "af_ai", // local only: API key (never synced)
    UI: "af_ui" // local: small UI prefs (fab position, panel open)
  };

  function uid() {
    return "x" + Math.random().toString(36).slice(2, 9);
  }

  function emptyData() {
    return {
      version: 1,
      updatedAt: 0,
      profile: {
        name: "",
        title: "",
        email: "",
        phone: "",
        location: "",
        links: { linkedin: "", portfolio: "", github: "", other: "" }
      },
      summary: { full: "", snippet: "" },
      experiences: [], // { id, company, role, start, end, location, full, snippet }
      skills: { full: "", snippet: "", list: [] },
      education: [], // { id, school, degree, field, year, full, snippet }
      custom: [], // { id, label, full, snippet }
      settings: {
        defaultMode: "full", // "full" | "snippet"
        syncUrl: "",
        onPage: { fab: true, chip: true, menu: true },
        ai: { provider: "openai", model: "gpt-4o" }
      }
    };
  }

  function newExperience() {
    return { id: uid(), company: "", role: "", start: "", end: "", location: "", full: "", snippet: "" };
  }
  function newEducation() {
    return { id: uid(), school: "", degree: "", field: "", year: "", full: "", snippet: "" };
  }
  function newCustom() {
    return { id: uid(), label: "", full: "", snippet: "" };
  }

  root.AF_MODEL = {
    KEYS: KEYS,
    uid: uid,
    emptyData: emptyData,
    newExperience: newExperience,
    newEducation: newEducation,
    newCustom: newCustom
  };
})(typeof self !== "undefined" ? self : this);
