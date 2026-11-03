(function () {
  "use strict";

  var Byron = self.Byron;
  var C = Byron.constants;
  var form = Byron.facebookForm;
  var utils = Byron.utils;
  var activeRunId = null;

  function send(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (response) {
        resolve(response || { ok: false, error: "No answer from the extension." });
      });
    });
  }

  function setStatus(message, error) {
    var panel = document.getElementById("torque-lister-status");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "torque-lister-status";
      panel.style.cssText = "position:fixed;z-index:2147483647;top:16px;right:16px;max-width:360px;padding:12px 14px;border-radius:10px;color:#fff;font:13px/1.35 Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)";
      document.documentElement.appendChild(panel);
    }
    panel.textContent = "Torque: " + message;
    panel.style.background = error ? "#991b1b" : "#1f2937";
  }

  /** Facebook's location box suggests places as you type: pick the matching one. */
  async function setLocation(place) {
    var r = await form.setIfPresent(["Location", "Item location"], place);
    if (r.skipped) return r;
    var town = place.split(",")[0].toLowerCase();
    try {
      var option = await form.waitFor(function () {
        return Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li')).find(function (o) {
          return form.visible(o) && utils.normalizeText(o.textContent).toLowerCase().indexOf(town) !== -1;
        });
      }, 6000, "No location suggestion");
      option.click();
      r.picked = true;
    } catch (e) {
      r.picked = false;
    }
    return r;
  }

  async function fill(unit) {
    var results = [];
    await form.ensureVehicleMode();
    // Vehicle type first: Facebook shows the right fields after it's chosen.
    results.push(await form.setIfPresent(["Vehicle type", "Type"], C.VEHICLE_TYPE));
    await utils.sleep(800);
    if (unit.year) results.push(await form.setIfPresent(["Year"], unit.year));
    if (unit.make) results.push(await form.setIfPresent(["Make"], unit.make));
    if (unit.model) results.push(await form.setIfPresent(["Model"], unit.model));
    if (unit.price) results.push(await form.setIfPresent(["Price", "Asking price"], String(unit.price)));
    results.push(await setLocation(C.LOCATION));
    // Close the location list before moving on, then type the description once.
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
    await utils.sleep(300);
    results.push(await form.setLongText(["Description", "Describe your item"], C.DESCRIPTION));
    return results;
  }

  async function photo(index) {
    var response = await send({ type: "GET_PHOTO", index: index });
    if (!response.ok) throw new Error(response.error || "Photo " + (index + 1) + " failed.");
    if (response.photo.skipped) return null;
    var binary = atob(response.photo.base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes.buffer], response.photo.filename, { type: response.photo.mime || "image/jpeg" });
  }

  async function run() {
    var response = await send({ type: "GET_LISTING_STATE" });
    if (!response.ok || !response.state) return;
    var state = response.state;
    if (!/\/marketplace\/(?:create|sell)/i.test(location.pathname)) {
      // Facebook sent us elsewhere (usually: not logged in).
      if (Date.now() - new Date(state.createdAt).getTime() < 5 * 60000) {
        setStatus("Facebook didn't open its listing form. Log in to Facebook in this browser, then click List on Facebook in Torque CRM again.", true);
      }
      return;
    }
    if (activeRunId === state.runId) return;
    activeRunId = state.runId;
    try {
      setStatus("waiting for Facebook's form…");
      await form.waitFor(function () {
        return form.findControl(["Vehicle type"]) || form.findControl(["Price"]) || form.findFileInput();
      }, 45000, "Facebook's listing form didn't load. Make sure you're logged in to Facebook.");
      setStatus("filling in " + (state.unit.title || "the unit") + "…");
      var results = await fill(state.unit);
      var files = [];
      var framed = 0;
      for (var i = 0; i < state.unit.photos.length; i += 1) {
        setStatus("adding watermarks: photo " + (i + 1) + " of " + state.unit.photos.length + "…");
        var f = await photo(i);
        if (f) files.push(f);
        else framed += 1;
      }
      if (!files.length) throw new Error("Every photo has the store's branded frame, so none were used. Pick a Florence unit or add photos by hand.");
      await form.uploadFiles(files);
      await send({ type: "LISTING_COMPLETE" });
      var missed = results.filter(function (r) { return r.skipped; }).map(function (r) { return r.field; });
      var loc = results.find(function (r) { return r.field === "Location"; });
      setStatus(
        "draft filled with " + files.length + " watermarked photos." +
          (framed ? " Left out " + framed + " photo" + (framed === 1 ? "" : "s") + " with the store's branded frame." : "") +
          (missed.length ? " Fill in by hand: " + missed.join(", ") + "." : "") +
          (loc && loc.picked === false ? " Pick Florence, Alabama in the location list." : "") +
          " Check everything, then click Next / Publish yourself."
      );
    } catch (error) {
      setStatus(error && error.message ? error.message : "Stopped.", true);
      activeRunId = null;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
