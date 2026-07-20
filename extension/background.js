/* Résumé Autofill — background service worker.
   Builds the right-click "Résumé Autofill" menu on form fields and relays
   the chosen block/mode to the content script in the active tab. */

var MENU = [
  ["af-sum-full", "Summary — full"],
  ["af-sum-snip", "Summary — snippet"],
  ["af-exp-full", "Experience — full"],
  ["af-exp-snip", "Experience — snippet"],
  ["af-skill-full", "Skills — full"],
  ["af-skill-snip", "Skills — snippet"],
  ["af-contact", "Contact details"]
];

var MAP = {
  "af-sum-full": ["summary", "full"],
  "af-sum-snip": ["summary", "snippet"],
  "af-exp-full": ["experience", "full"],
  "af-exp-snip": ["experience", "snippet"],
  "af-skill-full": ["skills", "full"],
  "af-skill-snip": ["skills", "snippet"]
};

function buildMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: "af-parent", title: "Résumé Autofill", contexts: ["editable"] });
    MENU.forEach(function (m) {
      chrome.contextMenus.create({ id: m[0], parentId: "af-parent", title: m[1], contexts: ["editable"] });
    });
    chrome.contextMenus.create({ id: "af-sep", parentId: "af-parent", type: "separator", contexts: ["editable"] });
    chrome.contextMenus.create({
      id: "af-panel",
      parentId: "af-parent",
      title: "Open autofill panel…",
      contexts: ["editable"]
    });
  });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === "af-panel") {
    chrome.tabs.sendMessage(tab.id, { type: "openPanel" }, { frameId: info.frameId });
    return;
  }
  if (info.menuItemId === "af-contact") {
    chrome.tabs.sendMessage(tab.id, { type: "autofillContact" }, { frameId: info.frameId });
    return;
  }
  var m = MAP[info.menuItemId];
  if (m) {
    chrome.tabs.sendMessage(tab.id, { type: "insert", block: m[0], mode: m[1] }, { frameId: info.frameId });
  }
});

/* Let popup/content open the options page. */
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
