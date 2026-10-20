/* DiaScreen site: theme toggle and module search. Everything works without JavaScript. */
(function () {
  "use strict";
  var root = document.documentElement;
  var MODES = ["auto", "light", "dark"];

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, val) { try { val ? localStorage.setItem(key, val) : localStorage.removeItem(key); } catch (e) {} }

  /* theme: auto -> light -> dark */
  var btn = document.querySelector("[data-theme-toggle]");
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") root.dataset.theme = mode; else delete root.dataset.theme;
    if (btn) {
      btn.dataset.mode = mode;
      btn.setAttribute("aria-label", "Colour theme: " + (mode === "auto" ? "automatic" : mode));
    }
  }
  var saved = get("ds:theme");
  applyTheme(saved === "light" || saved === "dark" ? saved : "auto");
  if (btn) btn.addEventListener("click", function () {
    var cur = btn.dataset.mode || "auto";
    var next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    set("ds:theme", next === "auto" ? null : next);
    applyTheme(next);
  });

  /* search: filter module cards by their text */
  var input = document.querySelector("[data-search]");
  var cards = Array.prototype.slice.call(document.querySelectorAll("[data-tool]"));
  var empty = document.querySelector("[data-empty]");
  var emptyQ = document.querySelector("[data-empty-q]");
  var clear = document.querySelector("[data-clear-search]");

  function filter() {
    var q = input.value.toLowerCase().trim();
    var words = q.split(/\s+/).filter(Boolean);
    var shown = 0;
    cards.forEach(function (c) {
      var text = c.dataset.text.toLowerCase();
      var hit = words.every(function (w) { return text.indexOf(w) !== -1; });
      c.hidden = !hit;
      if (hit) shown++;
    });
    if (empty) { empty.hidden = shown !== 0; if (emptyQ) emptyQ.textContent = input.value; }
  }
  if (input) {
    input.addEventListener("input", filter);
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (e.key === "/" && tag !== "input" && tag !== "textarea" && tag !== "select") {
        e.preventDefault(); input.focus();
      }
    });
  }
  if (clear) clear.addEventListener("click", function () { input.value = ""; filter(); input.focus(); });
})();
