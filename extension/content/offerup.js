(function () {
  "use strict";

  /**
   * OFFERUP: Torque CRM (Inventory → List on OfferUp) hands a unit over; this
   * runs on offerup.com and fills OfferUp's own posting form: your watermarked
   * photos, the title, description, price and ZIP. OfferUp's form comes in
   * steps, so this keeps watching and fills each field as it appears. It never
   * clicks Next or Post: you check it and post it yourself.
   *
   * A panel in the corner shows every value with a Copy button, so anything
   * OfferUp's page wouldn't take can be pasted in by hand.
   */
  var Byron = self.Byron;
  var C = Byron.constants;
  var form = Byron.facebookForm; // the same field helpers (find by label, set like a person typing)
  var WATCH_MS = 20 * 60000;
  var started = false;

  function send(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (response) {
        resolve(response || { ok: false, error: "No answer from the extension." });
      });
    });
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  var ui = { panel: null, status: null, rows: {} };

  function buildPanel(unit, fields) {
    var p = el("div", "position:fixed;z-index:2147483647;top:12px;right:12px;width:320px;max-height:calc(100vh - 24px);overflow:auto;padding:12px 14px;border-radius:12px;background:#111827;color:#fff;font:13px/1.4 Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)");
    p.id = "torque-offerup-panel";
    p.appendChild(el("div", "font-weight:700;font-size:14px;margin-bottom:2px", "Torque → OfferUp"));
    p.appendChild(el("div", "color:#9ca3af;margin-bottom:8px", unit.title || "Unit"));
    ui.status = el("div", "margin-bottom:10px", "Starting…");
    p.appendChild(ui.status);
    fields.forEach(function (f) {
      var row = el("div", "border-top:1px solid #374151;padding:7px 0;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:start");
      var name = el("div", "color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.05em", f.name);
      var state = el("div", "font-size:11px;color:#fbbf24;text-align:right", f.manual ? "by hand" : "waiting");
      var value = el("div", "white-space:pre-wrap;overflow-wrap:anywhere;max-height:66px;overflow:hidden", f.shown || f.value);
      var copy = el("button", "align-self:start;border:1px solid #4b5563;background:#1f2937;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px", "Copy");
      copy.type = "button";
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(f.value).then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); });
      });
      row.appendChild(name); row.appendChild(state); row.appendChild(value); row.appendChild(copy);
      p.appendChild(row);
      ui.rows[f.key] = state;
    });
    var done = el("button", "margin-top:10px;width:100%;border:0;background:#2563eb;color:#fff;border-radius:8px;padding:8px;cursor:pointer;font-weight:700", "Done (close this)");
    done.type = "button";
    done.addEventListener("click", function () { finish(); });
    p.appendChild(done);
    document.documentElement.appendChild(p);
    ui.panel = p;
  }

  function mark(key, text, ok) {
    var s = ui.rows[key];
    if (!s) return;
    s.textContent = text;
    s.style.color = ok ? "#34d399" : "#fbbf24";
  }
  function status(text, bad) {
    if (ui.status) { ui.status.textContent = text; ui.status.style.color = bad ? "#fca5a5" : "#fff"; }
  }

  var stopped = false;
  async function finish() {
    stopped = true;
    await send({ type: "LISTING_COMPLETE" });
    if (ui.panel) ui.panel.remove();
  }

  async function photoFile(index) {
    var response = await send({ type: "GET_PHOTO", index: index });
    if (!response.ok) throw new Error(response.error || "Photo " + (index + 1) + " failed.");
    if (response.photo.skipped) return null;
    var binary = atob(response.photo.base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes.buffer], response.photo.filename, { type: response.photo.mime || "image/jpeg" });
  }

  var norm = Byron.utils.normalizeText;
  var used = new Map(); // text box → the field it was used for (one box is never used for two fields)

  function textBoxes() {
    return Array.from(document.querySelectorAll("input, textarea")).filter(function (c) {
      if (c.tagName === "INPUT" && /^(file|checkbox|radio|submit|button|hidden|image|range|color)$/i.test(c.type || "")) return false;
      return form.visible(c) && !c.closest("#torque-offerup-panel") && !c.disabled && !c.readOnly;
    });
  }

  /** What a box calls itself: its aria-label, placeholder, name, <label for>, or a label wrapped around it. */
  function ownLabel(box) {
    var t = [box.getAttribute("aria-label"), box.getAttribute("placeholder"), box.getAttribute("name"), box.id].filter(Boolean).join(" ");
    var by = box.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach(function (id) { var l = document.getElementById(id); if (l) t += " " + l.textContent; });
    if (box.id) { var f = document.querySelector('label[for="' + CSS.escape(box.id) + '"]'); if (f) t += " " + f.textContent; }
    var wrap = box.closest("label");
    if (wrap) t += " " + wrap.textContent;
    return norm(t).toLowerCase();
  }

  /**
   * The text box for a field. First a box that names itself that way; otherwise
   * the nearest box after a piece of text that reads exactly like the label
   * (looking only a little way up the page from that text, so a label is never
   * matched to a box that belongs to something else).
   */
  function findBox(labels, key) {
    var wants = labels.map(function (l) { return String(l).toLowerCase(); });
    var boxes = textBoxes().filter(function (b) { return !used.has(b) || used.get(b) === key; });
    var own = boxes.find(function (b) { var t = ownLabel(b); return wants.some(function (w) { return t.indexOf(w) !== -1; }); });
    if (own) return own;
    var texts = Array.from(document.querySelectorAll("label, span, div, p, h2, h3, h4, legend")).filter(function (e) {
      if (e.closest("#torque-offerup-panel") || !form.visible(e)) return false;
      if (wants.indexOf(norm(e.textContent).toLowerCase().replace(/\s*[*:]$/, "")) === -1) return false;
      // the innermost element with that text, not the wrappers around it
      return !Array.from(e.children).some(function (c) { return norm(c.textContent) === norm(e.textContent); });
    });
    for (var i = 0; i < texts.length; i += 1) {
      var scope = texts[i];
      for (var up = 0; up < 3 && scope.parentElement; up += 1) {
        scope = scope.parentElement;
        var inside = boxes.filter(function (b) { return scope.contains(b) && (texts[i].compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
        if (inside.length) return inside[0];
      }
    }
    return null;
  }

  async function run() {
    var response = await send({ type: "GET_LISTING_STATE" });
    if (!response.ok || !response.state) return;
    var state = response.state;
    if (state.target !== "offerup") return;
    if (Date.now() - new Date(state.createdAt).getTime() > WATCH_MS) return;
    if (started) return;
    started = true;

    var unit = state.unit;
    var description = unit.description || C.describe(unit.payment, unit.accessories);
    var fields = [
      { key: "photos", name: "Photos", value: unit.photos.length + " watermarked photos", manual: false },
      { key: "title", name: "Title", value: unit.title, labels: ["Title", "What are you selling", "Item title", "Add a title"] },
      { key: "description", name: "Description", value: description, labels: ["Description", "Describe your item", "Add a description"] },
      { key: "price", name: "Price", value: unit.price ? String(unit.price) : "", labels: ["Price", "Set a price"] },
      { key: "zip", name: "ZIP code", value: C.OFFERUP.ZIP, labels: ["ZIP code", "Zip code", "ZIP", "Zipcode", "Postal code"] },
      { key: "condition", name: "Condition", value: unit.condition === "Used" ? "Used (normal wear)" : "New", manual: true },
      { key: "category", name: "Category", value: "Vehicles (pick the closest type)", manual: true }
    ].filter(function (f) { return f.value; });
    buildPanel(unit, fields);

    var filled = {};
    var photos = { state: "idle", files: null };
    var until = Date.now() + WATCH_MS;

    while (!stopped && Date.now() < until) {
      try {
        // Photos: made once (watermarks on), added as soon as OfferUp shows its photo picker.
        var picker = form.findFileInput();
        if (photos.state === "idle" && picker) {
          photos.state = "working";
          var files = [];
          for (var i = 0; i < unit.photos.length; i += 1) {
            status("Adding watermarks: photo " + (i + 1) + " of " + unit.photos.length + "…");
            var f = await photoFile(i);
            if (f) files.push(f);
          }
          if (!files.length) throw new Error("Every photo has the store's branded frame, so none were used. Add photos by hand.");
          await form.uploadFiles(files);
          photos.state = "done";
          mark("photos", files.length + " added", true);
        }
        // Text fields: each filled once, when its box is on screen and still empty.
        fields.forEach(function (fd) {
          if (fd.manual || !fd.labels || filled[fd.key]) return;
          var box = findBox(fd.labels, fd.key);
          if (!box) return;
          used.set(box, fd.key);
          if (String(box.value || "").trim()) { filled[fd.key] = true; mark(fd.key, "already there", true); return; }
          if (fd.key === "description") form.typeText(box, fd.value);
          else form.setNativeValue(box, fd.value);
          filled[fd.key] = true;
          mark(fd.key, "filled", true);
        });
        var waiting = fields.filter(function (fd) { return !fd.manual && fd.key !== "photos" && !filled[fd.key]; }).map(function (fd) { return fd.name; });
        if (photos.state !== "done" && !picker) status("Log in to OfferUp if asked, then open Post. I'll fill the form when it shows.");
        else if (waiting.length) status("Filled what's on this step. Click Next on OfferUp; still to come: " + waiting.join(", ") + ".");
        else status("Everything I can fill is in. Pick the category and condition, check it, then post it yourself.");
      } catch (error) {
        status(error && error.message ? error.message : "Something went wrong.", true);
        if (photos.state === "working") photos.state = "failed";
      }
      await Byron.utils.sleep(1200);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  // OfferUp is a single-page app: moving to its Post page doesn't reload, so look again now and then.
  setInterval(function () { if (!started) run(); }, 3000);
})();
