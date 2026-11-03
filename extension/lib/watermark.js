(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  /**
   * Where a watermark goes on a photo (pixels). `spec.width` is a share of the
   * photo's width; x / y are where its anchor point sits (0..1 of the photo).
   */
  function placement(photoW, photoH, markW, markH, spec) {
    var w = Math.round(photoW * spec.width);
    var h = Math.round(w * (markH / markW));
    // Very tall marks on wide-short photos: keep them under a third of the height.
    if (h > photoH / 3) {
      h = Math.round(photoH / 3);
      w = Math.round(h * (markW / markH));
    }
    var x = Math.round(photoW * spec.x);
    var y = Math.round(photoH * spec.y);
    var anchor = spec.anchor || "top-left";
    if (/center/.test(anchor)) x -= Math.round(w / 2);
    else if (/right/.test(anchor)) x -= w;
    if (/^bottom/.test(anchor)) y -= h;
    else if (/^middle/.test(anchor)) y -= Math.round(h / 2);
    return { x: Math.max(0, Math.min(photoW - w, x)), y: Math.max(0, Math.min(photoH - h, y)), w: w, h: h };
  }

  /**
   * The store's branded frame (Tuscumbia's main photos): a flat grey-blue
   * border (207, 216, 223) down the left edge. Such photos are left out
   * rather than stamped over.
   */
  function isStoreFramed(pixels) {
    var n = pixels.length / 4;
    if (!n) return false;
    var sum = [0, 0, 0], sq = [0, 0, 0];
    for (var i = 0; i < pixels.length; i += 4) {
      for (var c = 0; c < 3; c += 1) {
        sum[c] += pixels[i + c];
        sq[c] += pixels[i + c] * pixels[i + c];
      }
    }
    var frame = [207, 216, 223];
    for (var k = 0; k < 3; k += 1) {
      var mean = sum[k] / n;
      var sd = Math.sqrt(Math.max(0, sq[k] / n - mean * mean));
      if (Math.abs(mean - frame[k]) > 8 || sd > 6) return false;
    }
    return true;
  }

  /** The photo with the watermarks drawn on top. Nothing else about the photo changes. Null for a store-framed photo. */
  async function stamp(bytes, mime, marks, quality) {
    var photo = await createImageBitmap(new Blob([bytes], { type: mime || "image/jpeg" }));
    var canvas = new OffscreenCanvas(photo.width, photo.height);
    var ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not prepare the photo.");
    ctx.drawImage(photo, 0, 0);
    var sx = Math.round(photo.width * 0.01), sw = Math.max(1, Math.round(photo.width * 0.06));
    var sy = Math.round(photo.height * 0.15), sh = Math.max(1, Math.round(photo.height * 0.7));
    if (isStoreFramed(ctx.getImageData(sx, sy, sw, sh).data)) {
      photo.close();
      return null;
    }
    marks.forEach(function (m) {
      var p = placement(photo.width, photo.height, m.bitmap.width, m.bitmap.height, m.spec);
      ctx.globalAlpha = m.spec.opacity == null ? 0.85 : m.spec.opacity;
      ctx.drawImage(m.bitmap, p.x, p.y, p.w, p.h);
    });
    ctx.globalAlpha = 1;
    var size = { width: photo.width, height: photo.height };
    photo.close();
    var out = await canvas.convertToBlob({ type: "image/jpeg", quality: quality || 0.92 });
    return { buffer: await out.arrayBuffer(), mime: "image/jpeg", size: size };
  }

  Byron.watermark = { placement: placement, stamp: stamp, isStoreFramed: isStoreFramed };
})();
