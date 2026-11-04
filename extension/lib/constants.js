(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  // The description on every listing, exactly as written. {payment} is the
  // monthly payment you type in Torque CRM (from your grid); that line is left
  // out when there's none.
  var description = [
    "Payments as low as {payment} (WAC)",
    "✅️ NO HIDDEN FEES! ✅️",
    "",
    "",
    "Optional accessories not included in pricing...message for more details.",
    "",
    "⏳️ Message me with any questions or to set up a time to see this unit! ⏳️",
    "",
    "Shoals Outdoor Sports- Florence, AL",
    "🌐 shoalsoutdoorsports dot com"
  ].join("\n");

  /** The description for one unit: its monthly payment filled in (rounded up to the dollar). */
  function describe(payment) {
    var p = Number(payment);
    if (!(p > 0)) return description.split("\n").filter(function (l) { return l.indexOf("{payment}") === -1; }).join("\n");
    return description.replace("{payment}", money(p) + "/mo");
  }

  /** $100, $99.50, $1,250: the payment exactly as typed. */
  function money(p) {
    var whole = Math.abs(p - Math.round(p)) < 0.005;
    return "$" + (whole ? Math.round(p).toLocaleString("en-US") : p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  Byron.constants = {
    FACEBOOK_CREATE_URL: "https://www.facebook.com/marketplace/create/vehicle",
    DESCRIPTION: description,
    describe: describe,
    LOCATION: "Florence, Alabama",
    VEHICLE_TYPE: "Other",
    // Facebook takes up to 20 photos on a vehicle listing.
    MAX_PHOTOS: 20,
    // Where Torque CRM runs (the only pages allowed to start a listing).
    CRM_ORIGINS: ["https://torque-crm.byrongreen2012.workers.dev", "http://127.0.0.1:8788", "http://localhost:5180"],
    // Photo hosts (the dealer's DX1 image servers).
    PHOTO_HOST: /(^|\.)dx1app\.com$/i,
    LISTING_STATE_KEY: "torqueMarketplaceListing",
    // Every unit sent to Facebook (id → when, title), so Torque CRM can mark it Listed.
    LISTED_KEY: "torqueListedUnits",
    VERSION: "0.7.0",
    // The watermarks on every photo: a little see-through, nothing else changed.
    // Each has its own corner; the store's logo keeps the fourth (normally bottom-right).
    // If a photo has the store's logo in another corner, the watermark from that
    // corner moves to the free one, so every corner has something in it.
    WATERMARKS: [
      { file: "watermarks/no-dealer-fees.png", width: 0.34, corner: "top-left", opacity: 0.85 },
      { file: "watermarks/easy-buying.png", width: 0.25, corner: "top-right", opacity: 0.85 }
    ],
    // "$100 PER MONTH (WAC) / INBOX BYRON GREEN FOR DETAILS": drawn by Torque CRM
    // for each listing (the amount you type), bottom-left.
    PAYMENT_MARK: { width: 0.36, corner: "bottom-left", opacity: 0.85 },
    STORE_LOGO_CORNER: "bottom-right",
    // A small grey copy of the store's logo, used to find which corner it's in.
    STORE_LOGO_TEMPLATE: "lib/store-logo.png",
  };
})();
