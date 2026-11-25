(function () {
  "use strict";

  /**
   * Torque CRM ↔ the extension. The CRM page posts
   *   { source: "torque-crm", type: "LIST_ON_MARKETPLACE" | "LIST_ON_OFFERUP" | "LIST_ON_EBAY" | "PING", id, unit }
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
    var type = m.type === "LIST_ON_MARKETPLACE" ? "START_LISTING" : m.type === "LIST_ON_OFFERUP" ? "START_OFFERUP" : m.type === "LIST_ON_EBAY" ? "START_EBAY" : m.type === "PING" ? "PING" : null;
    if (!type) return;
    chrome.runtime.sendMessage({ type: type, unit: m.unit }, function (response) {
      var err = chrome.runtime.lastError;
      reply(m.id, err ? { ok: false, error: err.message } : response || { ok: false, error: "No answer from the extension." });
    });
  });

  /*
   * The other way round: "Save to Torque" on a Facebook chat (content/fb-chat.js →
   * background.js → here). The chat goes to the Torque page, which saves it and
   * drafts the reply (src/crm/chatLeads.ts). The page says CHAT_READY once
   * you're logged in; until then requests wait (up to 30 seconds).
   */
  var pageReady = false;
  var waiting = [];
  var pending = {};
  var seq = 0;

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    var m = event.data;
    if (!m || m.source !== "torque-crm") return;
    if (m.type === "CHAT_READY") {
      pageReady = true;
      waiting.splice(0).forEach(function (go) { go(); });
    } else if (m.type === "SAVE_CHAT_RESULT" && pending[m.id]) {
      pending[m.id](m);
      delete pending[m.id];
    }
  });

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "TORQUE_SAVE_CHAT") return false;
    var id = "chat-" + Date.now() + "-" + (++seq);
    var done = false;
    var finish = function (body) { if (!done) { done = true; sendResponse(body); } };
    var go = function () {
      pending[id] = function (m) { finish(m.ok ? { ok: true, result: m.result } : { ok: false, error: m.error || "Torque couldn't save it." }); };
      window.postMessage({ source: "torque-lister", type: "SAVE_CHAT", id: id, lead: message.lead }, window.location.origin);
      // Claude can take a little while to write the reply.
      setTimeout(function () { delete pending[id]; finish({ ok: false, error: "Torque didn't answer in time. Check the Torque tab, then try again." }); }, 120000);
    };
    if (pageReady) go();
    else {
      waiting.push(go);
      setTimeout(function () { finish({ ok: false, needsLogin: true, error: "Log in to Torque (the tab that just opened), then click Save again." }); }, 30000);
    }
    return true;
  });

  reply(null, { ok: true, type: "READY", version: chrome.runtime.getManifest().version });
})();
