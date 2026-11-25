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
    var full = await fetch(chrome.runtime.getURL(C.STORE_LOGO.file)).catch(function () { return null; });
    return {
      templates: Byron.watermark.logoTemplates(await createImageBitmap(await res.blob())),
      usualCorner: C.STORE_LOGO_CORNER,
      bitmap: full && full.ok ? await createImageBitmap(await full.blob()) : null,
      spec: C.STORE_LOGO
    };
  })().catch(function () { logoPromise = null; return null; });
  return logoPromise;
}

/** Units sent to Facebook from this browser (kept even if Torque CRM missed the reply). */
async function getListed() {
  var r = await chrome.storage.local.get(C.LISTED_KEY);
  return r[C.LISTED_KEY] || {};
}

/** The same record for eBay. */
async function getEbayListed() {
  var r = await chrome.storage.local.get(C.EBAY.LISTED_KEY);
  return r[C.EBAY.LISTED_KEY] || {};
}

async function rememberEbay(unit) {
  var all = await getEbayListed();
  all[unit.id] = { at: new Date().toISOString(), title: unit.title };
  var ids = Object.keys(all).sort(function (a, b) { return all[b].at.localeCompare(all[a].at); });
  ids.slice(3000).forEach(function (id) { delete all[id]; });
  await chrome.storage.local.set({ [C.EBAY.LISTED_KEY]: all });
}

/** The same record for OfferUp. */
async function getOfferUpListed() {
  var r = await chrome.storage.local.get(C.OFFERUP.LISTED_KEY);
  return r[C.OFFERUP.LISTED_KEY] || {};
}

async function rememberOfferUp(unit) {
  var all = await getOfferUpListed();
  all[unit.id] = { at: new Date().toISOString(), title: unit.title };
  var ids = Object.keys(all).sort(function (a, b) { return all[b].at.localeCompare(all[a].at); });
  ids.slice(3000).forEach(function (id) { delete all[id]; });
  await chrome.storage.local.set({ [C.OFFERUP.LISTED_KEY]: all });
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
function validUnit(u, maxPhotos, site) {
  maxPhotos = maxPhotos || C.MAX_PHOTOS;
  site = site || "Facebook";
  if (!u || typeof u !== "object") throw new Error("No unit was sent.");
  if (!Array.isArray(u.photos) || !u.photos.length) throw new Error("This unit has no photos to list.");
  if (u.photos.length > maxPhotos) throw new Error(site + " takes up to " + maxPhotos + " photos.");
  var uploads = Array.isArray(u.uploads) ? u.uploads : [];
  if (uploads.length > maxPhotos) throw new Error(site + " takes up to " + maxPhotos + " photos.");
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
    accessories: typeof u.accessories === "string" ? u.accessories.slice(0, 3000) : "",
    description: typeof u.description === "string" ? u.description.slice(0, 9000) : "",
    title: String(u.title || "").slice(0, 120),
    color: String(u.color || "").slice(0, 60),
    condition: /used|pre/i.test(String(u.condition || "")) ? "Used" : "New",
    stock: String(u.stock || "").slice(0, 40),
    vin: String(u.vin || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20),
    miles: Number(u.miles) >= 0 && u.miles !== null && u.miles !== "" ? Math.round(Number(u.miles)) : null,
    photos: u.photos.slice(0, maxPhotos),
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

/** A chat from Facebook, cut down to plain text of sensible length. */
function validChat(lead) {
  if (!lead || typeof lead !== "object") throw new Error("Nothing to save.");
  var text = function (v, max) { return String(v == null ? "" : v).slice(0, max); };
  var out = { thread: text(lead.thread, 80).replace(/[^\w.-]/g, ""), name: text(lead.name, 120).trim(), phone: text(lead.phone, 40).trim(), unit: text(lead.unit, 160).trim(), chat: text(lead.chat, 8000), url: text(lead.url, 300) };
  if (out.url && !/^https:\/\/www\.facebook\.com\//.test(out.url)) out.url = "";
  if (!out.name && !out.chat.trim()) throw new Error("Nothing to save: no name and no chat.");
  return out;
}

/** The Torque tab (the live site first), or a new one opened in the background. */
async function torqueTab() {
  var tabs = await chrome.tabs.query({});
  var mine = tabs.filter(function (t) {
    try { return t.url && C.CRM_ORIGINS.indexOf(new URL(t.url).origin) !== -1; } catch (e) { return false; }
  });
  mine.sort(function (a, b) { return C.CRM_ORIGINS.indexOf(new URL(a.url).origin) - C.CRM_ORIGINS.indexOf(new URL(b.url).origin); });
  if (mine.length) return { tab: mine[0], opened: false };
  return { tab: await chrome.tabs.create({ url: C.CRM_ORIGINS[0] + "/#/today", active: false }), opened: true };
}

async function saveChatInTorque(lead) {
  var found = await torqueTab();
  // A tab that's just opening needs a moment before its bridge (content/crm-bridge.js) answers.
  for (var i = 0; i < 40; i += 1) {
    try {
      var r = await chrome.tabs.sendMessage(found.tab.id, { type: "TORQUE_SAVE_CHAT", lead: lead });
      if (r && r.needsLogin) await chrome.tabs.update(found.tab.id, { active: true });
      return Object.assign({ crm: new URL(found.tab.url || found.tab.pendingUrl || C.CRM_ORIGINS[0]).origin }, r || { ok: false, error: "No answer from Torque." });
    } catch (e) {
      await new Promise(function (ok) { setTimeout(ok, 500); });
    }
  }
  return { ok: false, error: "Couldn't reach Torque. Open Torque in a tab, then try again." };
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
          offerup: { maxPhotos: C.OFFERUP.MAX_PHOTOS, listed: await getOfferUpListed() },
          ebay: { maxPhotos: C.EBAY.MAX_PHOTOS, listed: await getEbayListed() },
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
        var state = { runId: "run-" + Date.now() + "-" + Math.random().toString(36).slice(2), target: "facebook", unit: unit, createdAt: new Date().toISOString() };
        await storage().set({ [C.LISTING_STATE_KEY]: state });
        photoCache.clear();
        await rememberListed(state.unit);
        var tab = await chrome.tabs.create({ url: C.FACEBOOK_CREATE_URL, active: true });
        return sendResponse({ ok: true, tabId: tab.id, runId: state.runId });
      }

      // The same hand-over for OfferUp: its posting page is opened and content/offerup.js fills it.
      if (message.type === "START_OFFERUP") {
        var from = sender.origin || (sender.url && new URL(sender.url).origin);
        if (C.CRM_ORIGINS.indexOf(from) === -1) throw new Error("Listings can only be started from Torque CRM.");
        await loadMarks();
        var item = validUnit(message.unit, C.OFFERUP.MAX_PHOTOS, "OfferUp");
        await saveUploads(item.uploads);
        delete item.uploads;
        var run = { runId: "run-" + Date.now() + "-" + Math.random().toString(36).slice(2), target: "offerup", unit: item, createdAt: new Date().toISOString() };
        await storage().set({ [C.LISTING_STATE_KEY]: run });
        photoCache.clear();
        await rememberOfferUp(run.unit);
        var opened = await chrome.tabs.create({ url: C.OFFERUP.POST_URL, active: true });
        return sendResponse({ ok: true, tabId: opened.id, runId: run.runId });
      }

      // And for eBay Motors: its "What are you selling?" page opens and content/ebay.js fills what follows.
      if (message.type === "START_EBAY") {
        var asker = sender.origin || (sender.url && new URL(sender.url).origin);
        if (C.CRM_ORIGINS.indexOf(asker) === -1) throw new Error("Listings can only be started from Torque CRM.");
        await loadMarks();
        var ad = validUnit(message.unit, C.EBAY.MAX_PHOTOS, "eBay");
        await saveUploads(ad.uploads);
        delete ad.uploads;
        var go = { runId: "run-" + Date.now() + "-" + Math.random().toString(36).slice(2), target: "ebay", unit: ad, createdAt: new Date().toISOString() };
        await storage().set({ [C.LISTING_STATE_KEY]: go });
        photoCache.clear();
        await rememberEbay(go.unit);
        var page = await chrome.tabs.create({ url: C.EBAY.POST_URL, active: true });
        return sendResponse({ ok: true, tabId: page.id, runId: go.runId });
      }

      // "Save to Torque" on a Facebook chat (content/fb-chat.js): hand it to an open Torque tab
      // (opening one in the background if there isn't one), which saves it and drafts the reply.
      if (message.type === "SAVE_CHAT") {
        var from = sender.url ? new URL(sender.url).hostname : "";
        if (from !== "www.facebook.com") throw new Error("Chats can only be saved from Facebook.");
        return sendResponse(await saveChatInTorque(validChat(message.lead)));
      }

      // From the Facebook tab (content/facebook.js), the OfferUp tab (content/offerup.js) or the eBay tab (content/ebay.js).
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

/*
 * The extension's icon in Chrome's toolbar: on Facebook it opens the Save to
 * Torque panel (a backup if the button doesn't show on a chat); anywhere else
 * it opens Torque.
 */
chrome.action.onClicked.addListener(async function (tab) {
  var host = "";
  try { host = new URL(tab.url || "").hostname; } catch (e) { host = ""; }
  if (host !== "www.facebook.com") {
    await chrome.tabs.create({ url: C.CRM_ORIGINS[0] + "/#/today" });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TORQUE_OPEN_CHAT_PANEL" });
  } catch (e) {
    // The page was open before the extension was installed or updated: add the script, then open.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/fb-chat.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "TORQUE_OPEN_CHAT_PANEL" });
  }
});
