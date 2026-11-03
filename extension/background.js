"use strict";

importScripts("lib/constants.js", "lib/utils.js", "lib/watermark.js");

var Byron = self.Byron;
var C = Byron.constants;
var photoCache = new Map();
var marksPromise = null;

/**
 * TORQUE MARKETPLACE LISTER: Torque CRM (Inventory → List on Marketplace)
 * hands a unit over through content/crm-bridge.js; this opens Facebook's
 * vehicle form, and content/facebook.js fills it and uploads the photos,
 * each with the two watermarks drawn on. Nothing is ever published: you
 * review it on Facebook and click Publish yourself.
 */

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = "";
  for (var offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function storage() {
  return chrome.storage.session || chrome.storage.local;
}

async function getState() {
  var r = await storage().get(C.LISTING_STATE_KEY);
  return r[C.LISTING_STATE_KEY] || null;
}

function loadMarks() {
  marksPromise = marksPromise || Promise.all(C.WATERMARKS.map(async function (spec) {
    var res = await fetch(chrome.runtime.getURL(spec.file));
    if (!res.ok) throw new Error("Watermark " + spec.file + " is missing from the extension.");
    return { spec: spec, bitmap: await createImageBitmap(await res.blob()) };
  })).catch(function (e) { marksPromise = null; throw e; });
  return marksPromise;
}

/** Checks what Torque CRM sent: a real unit, with photos from the dealer's image servers. */
function validUnit(u) {
  if (!u || typeof u !== "object") throw new Error("No unit was sent.");
  if (!Array.isArray(u.photos) || !u.photos.length) throw new Error("This unit has no photos to list.");
  if (u.photos.length > C.MAX_PHOTOS) throw new Error("Facebook takes up to " + C.MAX_PHOTOS + " photos.");
  u.photos.forEach(function (url) {
    var host = new URL(url).hostname;
    if (new URL(url).protocol !== "https:" || !C.PHOTO_HOST.test(host)) throw new Error("A photo isn't from the dealer's image server: " + host);
  });
  return {
    id: String(u.id || ""),
    year: String(u.year || "").replace(/\D/g, "").slice(0, 4),
    make: String(u.make || "").slice(0, 60),
    model: String(u.model || "").slice(0, 80),
    price: u.price == null ? null : Math.round(Number(u.price)) || null,
    title: String(u.title || "").slice(0, 120),
    photos: u.photos.slice(0, C.MAX_PHOTOS)
  };
}

async function stampedPhoto(state, index) {
  var url = state.unit.photos[index];
  if (!url) throw new Error("Photo " + (index + 1) + " is missing.");
  var key = state.runId + ":" + index;
  if (photoCache.has(key)) return photoCache.get(key);
  var res = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error("Photo " + (index + 1) + " couldn't be downloaded (" + res.status + ").");
  var out = await Byron.watermark.stamp(await res.arrayBuffer(), res.headers.get("content-type"), await loadMarks(), 0.92);
  var result = { base64: arrayBufferToBase64(out.buffer), mime: out.mime, filename: "unit-photo-" + String(index + 1).padStart(2, "0") + ".jpg" };
  photoCache.set(key, result);
  return result;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  (async function () {
    try {
      if (!message || !message.type) throw new Error("Empty message.");

      // Torque CRM asks what a listing will look like (for its preview).
      if (message.type === "PING") {
        var marks = await Promise.all(C.WATERMARKS.map(async function (spec) {
          var res = await fetch(chrome.runtime.getURL(spec.file)).catch(function () { return null; });
          if (!res || !res.ok) return null;
          return { spec: spec, dataUrl: "data:image/png;base64," + arrayBufferToBase64(await res.arrayBuffer()) };
        }));
        return sendResponse({
          ok: true,
          version: C.VERSION,
          description: C.DESCRIPTION,
          location: C.LOCATION,
          vehicleType: C.VEHICLE_TYPE,
          maxPhotos: C.MAX_PHOTOS,
          watermarks: marks.filter(Boolean),
          missingWatermarks: marks.some(function (m) { return !m; })
        });
      }

      if (message.type === "START_LISTING") {
        var origin = sender.origin || (sender.url && new URL(sender.url).origin);
        if (C.CRM_ORIGINS.indexOf(origin) === -1) throw new Error("Listings can only be started from Torque CRM.");
        await loadMarks();
        var state = { runId: "run-" + Date.now() + "-" + Math.random().toString(36).slice(2), unit: validUnit(message.unit), createdAt: new Date().toISOString() };
        await storage().set({ [C.LISTING_STATE_KEY]: state });
        photoCache.clear();
        var tab = await chrome.tabs.create({ url: C.FACEBOOK_CREATE_URL, active: true });
        return sendResponse({ ok: true, tabId: tab.id, runId: state.runId });
      }

      // From the Facebook tab (content/facebook.js).
      if (message.type === "GET_LISTING_STATE") return sendResponse({ ok: true, state: await getState() });

      if (message.type === "GET_PHOTO") {
        var current = await getState();
        if (!current) throw new Error("The listing expired. Start again from Torque CRM → Inventory.");
        return sendResponse({ ok: true, photo: await stampedPhoto(current, Number(message.index)) });
      }

      if (message.type === "LISTING_COMPLETE") {
        await storage().remove(C.LISTING_STATE_KEY);
        photoCache.clear();
        return sendResponse({ ok: true });
      }

      throw new Error("Unknown message: " + message.type);
    } catch (error) {
      sendResponse({ ok: false, error: error && error.message ? error.message : "Something went wrong." });
    }
  })();
  return true;
});
