(function () {
  "use strict";

  /**
   * Torque CRM ↔ the extension. The CRM page posts
   *   { source: "torque-crm", type: "LIST_ON_MARKETPLACE" | "LIST_ON_OFFERUP" | "PING", id, unit }
   * and gets back { source: "torque-lister", id, ok, error?, version? }.
   * It also announces itself, so the CRM knows the extension is installed.
   */
  function reply(id, body) {
    window.postMessage(Object.assign({ source: "torque-lister", id: id }, body), window.location.origin);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    var m = event.data;
    if (!m || m.source !== "torque-crm") return;
    var type = m.type === "LIST_ON_MARKETPLACE" ? "START_LISTING" : m.type === "LIST_ON_OFFERUP" ? "START_OFFERUP" : m.type === "PING" ? "PING" : null;
    if (!type) return;
    chrome.runtime.sendMessage({ type: type, unit: m.unit }, function (response) {
      var err = chrome.runtime.lastError;
      reply(m.id, err ? { ok: false, error: err.message } : response || { ok: false, error: "No answer from the extension." });
    });
  });

  reply(null, { ok: true, type: "READY", version: chrome.runtime.getManifest().version });
})();
