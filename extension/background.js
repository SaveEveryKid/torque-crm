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
 * each with the three watermarks drawn on. Nothing is ever published: you
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

var logoPromise = null;
/** The store-logo template at the sizes it's searched for (to find which corner the logo is in). */
function loadLogo() {
  logoPromise = logoPromise || (async function () {
    var res = await fetch(chrome.runtime.getURL(C.STORE_LOGO_TEMPLATE));
    if (!res.ok) return null;
    return { templates: Byron.watermark.logoTemplates(await createImageBitmap(await res.blob())), usualCorner: C.STORE_LOGO_CORNER };
  })().catch(function () { logoPromise = null; return null; });
  return logoPromise;
}

/** Units sent to Facebook from this browser (kept even if Torque CRM missed the reply). */
async function getListed() {
  var r = await chrome.storage.local.get(C.LISTED_KEY);
  return r[C.LISTED_KEY] || {};
}

async function rememberListed(unit) {
  var all = await getListed();
  all[unit.id] = { at: new Date().toISOString(), title: unit.title };
  var ids = Object.keys(all).sort(function (a, b) { return all[b].at.localeCompare(all[a].at); });
  ids.slice(3000).forEach(function (id) { delete all[id]; });
  await chrome.storage.local.set({ [C.LISTED_KEY]: all });
}

/** The payment watermark Torque CRM drew (a PNG), or null. */
function validMark(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image/png;base64,") !== 0) return null;
  if (dataUrl.length > 4 * 1024 * 1024) throw new Error("The payment watermark is too big.");
  return dataUrl;
}

var paymentBitmap = { key: null, promise: null };
/** The fixed watermarks plus this listing's payment watermark. */
async function marksFor(state) {
  var fixed = await loadMarks();
  if (!state.unit.paymentMark) return fixed;
  if (paymentBitmap.key !== state.runId) {
    paymentBitmap = { key: state.runId, promise: fetch(state.unit.paymentMark).then(function (r) { return r.blob(); }).then(createImageBitmap) };
  }
  return fixed.concat([{ spec: C.PAYMENT_MARK, bitmap: await paymentBitmap.promise }]);
}

/** Checks what Torque CRM sent: a real unit, with photos from the dealer's image servers. */
function validUnit(u) {
  if (!u || typeof u !== "object") throw new Error("No unit was sent.");
  if (!Array.isArray(u.photos) || !u.photos.length) throw new Error("This unit has no photos to list.");
  if (u.photos.length > C.MAX_PHOTOS) throw new Error("Facebook takes up to " + C.MAX_PHOTOS + " photos.");
  var uploads = Array.isArray(u.uploads) ? u.uploads : [];
  if (uploads.length > C.MAX_PHOTOS) throw new Error("Facebook takes up to " + C.MAX_PHOTOS + " photos.");
  uploads.forEach(function (d) {
    if (typeof d !== "string" || d.indexOf("data:image/jpeg;base64,") !== 0) throw new Error("One of your photos didn't come through. Add it again.");
    if (d.length > 8 * 1024 * 1024) throw new Error("One of your photos is too big.");
  });
  u.photos.forEach(function (url) {
    // Your own photo (sent with the listing) or one from the dealer's image server.
    var own = /^upload:(\d+)$/.exec(String(url));
    if (own) {
      if (!uploads[Number(own[1])]) throw new Error("One of your photos is missing. Add it again.");
      return;
    }
    var host = new URL(url).hostname;
    if (new URL(url).protocol !== "https:" || !C.PHOTO_HOST.test(host)) throw new Error("A photo isn't from the dealer's image server: " + host);
  });
  return {
    id: String(u.id || ""),
    year: String(u.year || "").replace(/\D/g, "").slice(0, 4),
    make: String(u.make || "").slice(0, 60),
    model: String(u.model || "").slice(0, 80),
    price: u.price == null ? null : Math.round(Number(u.price)) || null,
    payment: Number(u.payment) > 0 ? Math.min(Number(u.payment), 100000) : null,
    paymentMark: validMark(u.paymentMark),
    title: String(u.title || "").slice(0, 120),
    photos: u.photos.slice(0, C.MAX_PHOTOS),
    uploads: uploads
  };
}

var UPLOAD_KEY = "torqueUpload:";

/** Your own photos for this listing, kept until it's done (they can be big, so not in the listing state). */
async function saveUploads(uploads) {
  await clearUploads();
  var put = {};
  uploads.forEach(function (d, i) { put[UPLOAD_KEY + i] = d; });
  if (uploads.length) await chrome.storage.local.set(put);
}

async function clearUploads() {
  var all = await chrome.storage.local.get(null);
  var old = Object.keys(all).filter(function (k) { return k.indexOf(UPLOAD_KEY) === 0; });
  if (old.length) await chrome.storage.local.remove(old);
}

async function stampedPhoto(state, index) {
  var url = state.unit.photos[index];
  if (!url) throw new Error("Photo " + (index + 1) + " is missing.");
  var key = state.runId + ":" + index;
  if (photoCache.has(key)) return photoCache.get(key);
  var own = /^upload:(\d+)$/.exec(url);
  if (own) {
    var got = await chrome.storage.local.get(UPLOAD_KEY + own[1]);
    url = got[UPLOAD_KEY + own[1]];
    if (!url) throw new Error("Photo " + (index + 1) + " (one of yours) is missing. Start again from Torque CRM.");
  }
  var res = await fetch(url, own ? {} : { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error("Photo " + (index + 1) + " couldn't be downloaded (" + res.status + ").");
  var out = await Byron.watermark.stamp(await res.arrayBuffer(), res.headers.get("content-type"), await marksFor(state), 0.92, await loadLogo());
  // The store's branded frame: left out, never stamped over.
  if (!out) {
    photoCache.set(key, { skipped: true });
    return { skipped: true };
  }
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
          return { spec: Byron.watermark.cornerSpec(spec, spec.corner), dataUrl: "data:image/png;base64," + arrayBufferToBase64(await res.arrayBuffer()) };
        }));
        return sendResponse({
          ok: true,
          version: C.VERSION,
          description: C.DESCRIPTION,
          location: C.LOCATION,
          vehicleType: C.VEHICLE_TYPE,
          maxPhotos: C.MAX_PHOTOS,
          watermarks: marks.filter(Boolean),
          paymentSpec: Byron.watermark.cornerSpec(C.PAYMENT_MARK, C.PAYMENT_MARK.corner),
          listed: await getListed(),
          missingWatermarks: marks.some(function (m) { return !m; })
        });
      }

      if (message.type === "START_LISTING") {
        var origin = sender.origin || (sender.url && new URL(sender.url).origin);
        if (C.CRM_ORIGINS.indexOf(origin) === -1) throw new Error("Listings can only be started from Torque CRM.");
        await loadMarks();
        var unit = validUnit(message.unit);
        await saveUploads(unit.uploads);
        delete unit.uploads;
        var state = { runId: "run-" + Date.now() + "-" + Math.random().toString(36).slice(2), unit: unit, createdAt: new Date().toISOString() };
        await storage().set({ [C.LISTING_STATE_KEY]: state });
        photoCache.clear();
        await rememberListed(state.unit);
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
        await clearUploads();
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
