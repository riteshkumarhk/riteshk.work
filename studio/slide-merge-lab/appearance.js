(function () {
  var key = "rk:theme";
  var media = window.matchMedia("(prefers-color-scheme: light)");
  var timer = 0;
  function mode() { try { return localStorage.getItem(key) || "system"; } catch { return "system"; } }
  function isLight(value) {
    value = value || mode();
    if (value === "day") return true;
    if (value === "night") return false;
    if (value === "local") { var hour = new Date().getHours(); return hour >= 7 && hour < 19; }
    return media.matches;
  }
  function apply() {
    var light = isLight();
    document.documentElement.setAttribute("data-appearance", light ? "light" : "dark");
    document.documentElement.setAttribute("data-theme-mode", mode());
    window.dispatchEvent(new CustomEvent("theme:change", { detail: { mode: mode(), light: light } }));
  }
  function schedule() {
    clearInterval(timer);
    if (mode() === "local") timer = setInterval(apply, 60000);
  }
  window.__theme = {
    mode: mode,
    isLight: isLight,
    apply: apply,
    set: function (value) { try { localStorage.setItem(key, value); } catch {} apply(); schedule(); }
  };
  media.addEventListener("change", function () { if (mode() === "system") apply(); });
  window.addEventListener("storage", function (event) { if (event.key === key || event.key === null) { apply(); schedule(); } });
  window.addEventListener("focus", apply);
  apply(); schedule();
})();