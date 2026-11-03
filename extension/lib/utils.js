(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  Byron.utils = { normalizeText: normalizeText, sleep: sleep };
})();
