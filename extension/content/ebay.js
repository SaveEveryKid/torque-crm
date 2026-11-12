(function () {
  "use strict";

  /**
   * EBAY MOTORS: Torque CRM (Inventory → List on eBay) hands a unit over; this
   * runs on ebay.com's selling pages and fills them as they come on screen:
   *  - the start page ("What are you selling?"): types the unit's title;
   *  - the listing form: title, VIN, year, make, model, mileage, price, ZIP,
   *    description and your watermarked photos, and sets the format to
   *    Classified ad (a local classified ad, as Byron lists on eBay).
   * eBay's category and condition choices are left to you (the panel says
   * which), and it never clicks List: you check it and list it yourself.
   *
   * A panel in the corner shows every value with a Copy button, so anything
   * eBay's page wouldn't take can be pasted in by hand.
   */
  var Byron = self.Byron;
  var C = Byron.constants;
  var form = Byron.facebookForm; // the shared field helpers (find by label, set like a person typing)
  var norm = Byron.utils.normalizeText;
  var WATCH_MS = 30 * 60000;
  var PANEL = "torque-ebay-panel";
  var started = false;
  var stopped = false;

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
    var p = el("div", "position:fixed;z-index:2147483647;top:12px;right:12px;width:330px;max-height:calc(100vh - 24px);overflow:auto;padding:12px 14px;border-radius:12px;background:#111827;color:#fff;font:13px/1.4 Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)");
    p.id = PANEL;
    p.appendChild(el("div", "font-weight:700;font-size:14px;margin-bottom:2px", "Torque → eBay Motors (classified ad)"));
    p.appendChild(el("div", "color:#9ca3af;margin-bottom:8px", unit.title || "Unit"));
    ui.status = el("div", "margin-bottom:10px", "Starting…");
    p.appendChild(ui.status);
    fields.forEach(function (f) {
      var row = el("div", "border-top:1px solid #374151;padding:7px 0;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:start");
      row.appendChild(el("div", "color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.05em", f.name));
      var state = el("div", "font-size:11px;color:#fbbf24;text-align:right", f.manual ? "you do this" : "waiting");
      row.appendChild(state);
      row.appendChild(el("div", "white-space:pre-wrap;overflow-wrap:anywhere;max-height:66px;overflow:hidden", f.shown || f.value));
      var copy = el("button", "align-self:start;border:1px solid #4b5563;background:#1f2937;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px", "Copy");
      copy.type = "button";
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(f.value).then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); });
      });
      row.appendChild(copy);
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

  var used = new Map(); // text box → the field it was used for (one box is never used for two fields)

  /** "Item title *", "VIN (required)", "Price:" → "item title", "vin", "price". */
  function plain(t) {
    return norm(t).toLowerCase().replace(/\s*\((optional|required)\)/g, "").replace(/\s*[*:]+$/, "").trim();
  }

  function textBoxes() {
    return Array.from(document.querySelectorAll("input, textarea, [contenteditable=true], [contenteditable='']")).filter(function (c) {
      if (c.tagName === "INPUT" && /^(file|checkbox|radio|submit|button|hidden|image|range|color)$/i.test(c.type || "")) return false;
      return form.visible(c) && !c.closest("#" + PANEL) && !c.disabled && !c.readOnly;
    });
  }

  /** What a box calls itself: aria-label, placeholder, name, id, its <label>, or a label around it. */
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
   * The text box for a field: one that names itself that way (whole words), or
   * the nearest box after text that reads exactly like the label.
   */
  function findBox(labels, key) {
    var wants = labels.map(function (l) { return String(l).toLowerCase(); });
    var boxes = textBoxes().filter(function (b) { return !used.has(b) || used.get(b) === key; });
    var words = function (t, w) { return new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(t); };
    var own = boxes.find(function (b) { var t = ownLabel(b); return wants.some(function (w) { return words(t, w); }); });
    if (own) return own;
    var texts = Array.from(document.querySelectorAll("label, span, div, p, h2, h3, h4, legend, dt")).filter(function (e) {
      if (e.closest("#" + PANEL) || !form.visible(e)) return false;
      if (wants.indexOf(plain(e.textContent)) === -1) return false;
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

  function valueOf(box) {
    return box.isContentEditable ? box.textContent : box.value;
  }

  /** eBay's Format list (a plain <select> or a menu): pick the classified ad. */
  function chooseClassified() {
    var sel = Array.from(document.querySelectorAll("select")).find(function (s) {
      return form.visible(s) && Array.from(s.options).some(function (o) { return /classified/i.test(o.textContent); });
    });
    if (!sel) return null;
    var opt = Array.from(sel.options).find(function (o) { return /classified/i.test(o.textContent); });
    if (sel.value === opt.value) return "already";
    var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "set";
  }

  /** Start page: "What are you selling?" → type the title and start. */
  function startBox() {
    return findBox(["What are you selling", "Tell us what you're selling", "Enter keywords", "Search for a product", "Enter a brand, model"], "start");
  }

  function onListingForm() {
    return /\/lstng|\/sl\/list|mode=AddItem/i.test(location.href) || !!findBox(["Item title", "Title"], "title");
  }

  async function run() {
    var response = await send({ type: "GET_LISTING_STATE" });
    if (!response.ok || !response.state) return;
    var state = response.state;
    if (state.target !== "ebay") return;
    if (Date.now() - new Date(state.createdAt).getTime() > WATCH_MS) return;
    if (started) return;
    started = true;

    var unit = state.unit;
    var description = unit.description || C.describe(unit.payment, unit.accessories);
    var title = String(unit.title || "").slice(0, C.EBAY.TITLE_MAX);
    var fields = [
      { key: "photos", name: "Photos", value: unit.photos.length + " watermarked photos" },
      { key: "title", name: "Title", value: title, labels: ["Item title", "Title"] },
      { key: "vin", name: "VIN", value: unit.vin || "", labels: ["VIN", "Vehicle Identification Number", "Vehicle identification number (VIN)"] },
      { key: "year", name: "Year", value: unit.year || "", labels: ["Year"] },
      { key: "make", name: "Make", value: unit.make || "", labels: ["Make"] },
      { key: "model", name: "Model", value: unit.model || "", labels: ["Model"] },
      { key: "miles", name: "Mileage", value: unit.miles != null ? String(unit.miles) : "", labels: ["Vehicle Mileage", "Mileage", "Odometer"] },
      { key: "price", name: "Price", value: unit.price ? String(unit.price) : "", labels: ["Classified ad price", "Price", "Buy It Now price", "Item price"] },
      { key: "zip", name: "ZIP code", value: C.EBAY.ZIP, labels: ["ZIP code", "Zip code", "Postal code", "Item location"] },
      { key: "description", name: "Description", value: description, labels: ["Description", "Item description"] },
      { key: "format", name: "Format", value: "Classified ad", choice: true },
      { key: "category", name: "Category", value: "eBay Motors › Powersports (UTVs / ATVs…)", manual: true },
      { key: "condition", name: "Condition", value: unit.condition === "Used" ? "Used" : "New", manual: true }
    ].filter(function (f) { return f.value; });
    buildPanel(unit, fields);

    var filled = {};
    var startTyped = false;
    var photos = { state: "idle" };
    var until = Date.now() + WATCH_MS;

    while (!stopped && Date.now() < until) {
      try {
        if (!onListingForm()) {
          // Start page: type the title once; you choose the category eBay suggests.
          var box = !startTyped && startBox();
          if (box) {
            used.set(box, "start");
            form.typeText(box, title);
            startTyped = true;
            status("Typed the title. Press Enter (or Get started), then pick the eBay Motors category that fits (Powersports → UTVs, ATVs…) and the condition. I'll fill the listing form when it opens.");
          } else if (!startTyped) {
            status("Log in to eBay if asked. I'll type the title on the “What are you selling?” page and fill the listing form when it opens.");
          }
        } else {
          // Photos: made once (watermarks on), added as soon as eBay shows its photo picker.
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
            var b = findBox(fd.labels, fd.key);
            if (!b) return;
            used.set(b, fd.key);
            if (String(valueOf(b) || "").trim()) { filled[fd.key] = true; mark(fd.key, "already there", true); return; }
            if (fd.key === "description" || b.isContentEditable) form.typeText(b, fd.value);
            else form.setNativeValue(b, fd.value);
            filled[fd.key] = true;
            mark(fd.key, "filled", true);
          });
          if (!filled.format) {
            var fmt = chooseClassified();
            if (fmt) { filled.format = true; mark("format", fmt === "already" ? "already there" : "set", true); }
          }
          var waiting = fields.filter(function (fd) { return !fd.manual && fd.key !== "photos" && !filled[fd.key]; }).map(function (fd) { return fd.name; });
          if (waiting.length) status("Filled what I can see. Scroll down or open eBay's sections (item specifics, pricing); still to fill: " + waiting.join(", ") + ". Anything I can't reach, use Copy.");
          else status("All filled in. Check category, condition and fees, then click List yourself.");
        }
      } catch (error) {
        status(error && error.message ? error.message : "Something went wrong.", true);
        if (photos.state === "working") photos.state = "failed";
      }
      await Byron.utils.sleep(1200);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  // eBay moves between its selling pages without always reloading: look again now and then.
  setInterval(function () { if (!started) run(); }, 3000);
})();
