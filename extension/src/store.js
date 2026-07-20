/* Résumé Autofill — storage helpers.
   Source of truth is chrome.storage.local (no size limit worries).
   We ALSO mirror to chrome.storage.sync in chunks so the data rides along
   with your signed-in Edge/Chrome profile across every PC (cross-device). */
(function (root) {
  "use strict";

  var M = root.AF_MODEL;
  var K = M.KEYS;
  var CHUNK = 6000; // chars per sync item (sync limit is ~8 KB/item, ~100 KB total)

  function localGet(keys) {
    return new Promise(function (res) {
      chrome.storage.local.get(keys, function (v) {
        res(v || {});
      });
    });
  }
  function localSet(obj) {
    return new Promise(function (res, rej) {
      chrome.storage.local.set(obj, function () {
        var e = chrome.runtime.lastError;
        e ? rej(new Error(e.message)) : res();
      });
    });
  }
  function syncGet(keys) {
    return new Promise(function (res) {
      chrome.storage.sync.get(keys, function (v) {
        res(v || {});
      });
    });
  }
  function syncSet(obj) {
    return new Promise(function (res, rej) {
      chrome.storage.sync.set(obj, function () {
        var e = chrome.runtime.lastError;
        e ? rej(new Error(e.message)) : res();
      });
    });
  }
  function syncRemove(keys) {
    return new Promise(function (res) {
      chrome.storage.sync.remove(keys, function () {
        res();
      });
    });
  }

  function chunkString(str) {
    var out = [];
    for (var i = 0; i < str.length; i += CHUNK) out.push(str.slice(i, i + CHUNK));
    return out;
  }

  function mergeShape(base, data) {
    data = data || {};
    var d = Object.assign({}, base, data);
    d.profile = Object.assign({}, base.profile, data.profile || {});
    d.profile.links = Object.assign({}, base.profile.links, (data.profile && data.profile.links) || {});
    d.summary = Object.assign({}, base.summary, data.summary || {});
    d.skills = Object.assign({}, base.skills, data.skills || {});
    if (!Array.isArray(d.skills.list)) d.skills.list = [];
    d.settings = Object.assign({}, base.settings, data.settings || {});
    d.settings.onPage = Object.assign({}, base.settings.onPage, (data.settings && data.settings.onPage) || {});
    d.settings.ai = Object.assign({}, base.settings.ai, (data.settings && data.settings.ai) || {});
    d.experiences = Array.isArray(data.experiences) ? data.experiences : [];
    d.education = Array.isArray(data.education) ? data.education : [];
    d.custom = Array.isArray(data.custom) ? data.custom : [];
    return d;
  }

  async function saveData(data) {
    data.updatedAt = Date.now();
    var json = JSON.stringify(data);
    await localSet(makeObj(K.DATA, json));
    // Best-effort mirror to sync (ignore quota errors — local copy is authoritative).
    try {
      var prev = (await syncGet(K.SYNC_META))[K.SYNC_META];
      if (prev && prev.chunks) {
        var old = [];
        for (var i = 0; i < prev.chunks; i++) old.push(K.SYNC_CHUNK + i);
        await syncRemove(old);
      }
      var chunks = chunkString(json);
      var obj = {};
      chunks.forEach(function (c, idx) {
        obj[K.SYNC_CHUNK + idx] = c;
      });
      obj[K.SYNC_META] = { chunks: chunks.length, ts: data.updatedAt };
      await syncSet(obj);
    } catch (e) {
      console.warn("[autofill] cross-device sync skipped:", e && e.message);
    }
    return data;
  }

  async function readLocal() {
    try {
      var v = (await localGet(K.DATA))[K.DATA];
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }
  async function readSync() {
    try {
      var meta = (await syncGet(K.SYNC_META))[K.SYNC_META];
      if (!meta || !meta.chunks) return null;
      var keys = [];
      for (var i = 0; i < meta.chunks; i++) keys.push(K.SYNC_CHUNK + i);
      var parts = await syncGet(keys);
      var s = "";
      for (var j = 0; j < meta.chunks; j++) s += parts[K.SYNC_CHUNK + j] || "";
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  async function loadData() {
    var local = await readLocal();
    var sync = await readSync();
    var chosen;
    if (local && sync) chosen = (sync.updatedAt || 0) > (local.updatedAt || 0) ? sync : local;
    else chosen = local || sync || M.emptyData();
    var shaped = mergeShape(M.emptyData(), chosen);
    // If sync was newer than local, refresh the local copy so this device catches up.
    if (sync && (!local || (sync.updatedAt || 0) > (local.updatedAt || 0))) {
      try {
        await localSet(makeObj(K.DATA, JSON.stringify(shaped)));
      } catch (e) {}
    }
    return shaped;
  }

  async function getAiKey() {
    return (await localGet(K.AI))[K.AI] || "";
  }
  async function setAiKey(k) {
    return localSet(makeObj(K.AI, k || ""));
  }

  async function getUi() {
    return (await localGet(K.UI))[K.UI] || {};
  }
  async function setUi(ui) {
    return localSet(makeObj(K.UI, ui || {}));
  }

  async function syncFromUrl(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var remote = mergeShape(M.emptyData(), await res.json());
    return saveData(remote);
  }

  function makeObj(key, val) {
    var o = {};
    o[key] = val;
    return o;
  }

  root.AFStore = {
    saveData: saveData,
    loadData: loadData,
    mergeShape: mergeShape,
    getAiKey: getAiKey,
    setAiKey: setAiKey,
    getUi: getUi,
    setUi: setUi,
    syncFromUrl: syncFromUrl
  };
})(typeof self !== "undefined" ? self : this);
