(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  /**
   * Where a watermark goes on a photo (pixels). `spec.width` is a share of the
   * photo's width; x / y are where its anchor point sits (0..1 of the photo).
   */
  function placement(photoW, photoH, markW, markH, spec) {
    if (spec.corner && spec.x == null) spec = cornerSpec(spec, spec.corner);
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


  var CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
  var MARGIN_X = 0.025, MARGIN_Y = 0.03;

  /** A watermark spec tucked into a corner (x / y / anchor for placement). */
  function cornerSpec(spec, corner) {
    var out = {};
    for (var k in spec) out[k] = spec[k];
    out.corner = corner;
    out.anchor = corner;
    out.x = /right/.test(corner) ? 1 - MARGIN_X : MARGIN_X;
    out.y = /^bottom/.test(corner) ? 1 - MARGIN_Y : MARGIN_Y;
    return out;
  }

  /**
   * Which corner each watermark goes in. The store's logo keeps its corner;
   * the watermark that would have gone there takes the corner the logo
   * usually has (so all four corners stay filled).
   */
  function arrange(specs, logoCorner, usualLogoCorner) {
    var usual = usualLogoCorner || "bottom-right";
    var logo = logoCorner || usual;
    return specs.map(function (spec) {
      var corner = spec.corner === logo ? usual : spec.corner;
      return cornerSpec(spec, corner);
    });
  }

  /** Grey values (0..255) of RGBA pixels. */
  function grayOf(rgba) {
    var n = rgba.length / 4, g = new Float32Array(n);
    for (var i = 0; i < n; i += 1) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return g;
  }

  /** Best normalised match of a template anywhere in one corner region of a grey image. */
  function bestMatch(gray, W, x0, y0, rw, rh, t) {
    if (t.w > rw || t.h > rh) return -1;
    var tm = 0, i, j;
    for (i = 0; i < t.data.length; i += 1) tm += t.data[i];
    tm /= t.data.length;
    var tz = new Float32Array(t.data.length), tn = 0;
    for (i = 0; i < t.data.length; i += 1) { tz[i] = t.data[i] - tm; tn += tz[i] * tz[i]; }
    tn = Math.sqrt(tn);
    if (!tn) return -1;
    var best = -1, n = t.w * t.h;
    for (var y = y0; y <= y0 + rh - t.h; y += 1) {
      for (var x = x0; x <= x0 + rw - t.w; x += 1) {
        var sum = 0, sq = 0, cross = 0;
        for (j = 0; j < t.h; j += 1) {
          var row = (y + j) * W + x, trow = j * t.w;
          for (i = 0; i < t.w; i += 1) {
            var v = gray[row + i];
            sum += v; sq += v * v; cross += v * tz[trow + i];
          }
        }
        var varp = sq - (sum * sum) / n;
        if (varp <= 0) continue;
        var score = cross / (Math.sqrt(varp) * tn);
        if (score > best) best = score;
      }
    }
    return best;
  }

  /**
   * Which corner of the photo has the store's logo (null when none does).
   * `gray` is the photo shrunk to about 240 px wide; `templates` are the
   * logo, also grey, at a few sizes.
   */
  function logoCorner(gray, W, H, templates, threshold) {
    var rw = Math.floor(W * 0.38), rh = Math.floor(H * 0.38);
    var at = { "top-left": [0, 0], "top-right": [W - rw, 0], "bottom-left": [0, H - rh], "bottom-right": [W - rw, H - rh] };
    var found = null, top = threshold == null ? 0.55 : threshold;
    CORNERS.forEach(function (c) {
      var s = -1;
      templates.forEach(function (t) { s = Math.max(s, bestMatch(gray, W, at[c][0], at[c][1], rw, rh, t)); });
      if (s > top) { top = s; found = c; }
    });
    return found;
  }

  var SMALL = 240;
  var LOGO_SIZES = [0.12, 0.15, 0.18, 0.21];

  function shrinkGray(source, w, h) {
    var c = new OffscreenCanvas(w, h);
    var x = c.getContext("2d");
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(source, 0, 0, w, h);
    return grayOf(x.getImageData(0, 0, w, h).data);
  }

  /** The logo template at the sizes it's looked for (photo shrunk to SMALL wide). */
  function logoTemplates(bitmap) {
    return LOGO_SIZES.map(function (f) {
      var w = Math.round(SMALL * f), h = Math.round(w * bitmap.height / bitmap.width);
      return { w: w, h: h, data: shrinkGray(bitmap, w, h) };
    });
  }

  /** Finds the store's logo corner on a decoded photo. */
  function findLogo(photo, templates) {
    if (!templates || !templates.length) return null;
    var h = Math.max(1, Math.round(SMALL * photo.height / photo.width));
    return logoCorner(shrinkGray(photo, SMALL, h), SMALL, h, templates);
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

  /**
   * The photo with the watermarks drawn on top. Nothing else about the photo
   * changes. Null for a store-framed photo. `logo` = { templates, usualCorner }:
   * the watermarks are arranged around wherever the store's logo is.
   */
  async function stamp(bytes, mime, marks, quality, logo) {
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
    var logoAt = logo ? findLogo(photo, logo.templates) : null;
    var specs = arrange(marks.map(function (m) { return m.spec; }), logoAt, logo && logo.usualCorner);
    marks.forEach(function (m, i) {
      var p = placement(photo.width, photo.height, m.bitmap.width, m.bitmap.height, specs[i]);
      ctx.globalAlpha = m.spec.opacity == null ? 0.85 : m.spec.opacity;
      ctx.drawImage(m.bitmap, p.x, p.y, p.w, p.h);
    });
    ctx.globalAlpha = 1;
    var size = { width: photo.width, height: photo.height };
    photo.close();
    var out = await canvas.convertToBlob({ type: "image/jpeg", quality: quality || 0.92 });
    return { buffer: await out.arrayBuffer(), mime: "image/jpeg", size: size, logoCorner: logoAt };
  }

  Byron.watermark = {
    placement: placement,
    stamp: stamp,
    isStoreFramed: isStoreFramed,
    cornerSpec: cornerSpec,
    arrange: arrange,
    grayOf: grayOf,
    logoCorner: logoCorner,
    logoTemplates: logoTemplates
  };
})();
