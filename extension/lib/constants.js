(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  // The description on every listing, exactly as written.
  var description = [
    "✅️ NO HIDDEN FEES! ✅️",
    "",
    "Optional accessories not included in pricing...message for more details.",
    "",
    "⏳️ Message me with any questions or to set up a time to see this unit! ⏳️",
    "",
    "‼️ Follow me on Marketplace for the best deals! ‼️",
    "",
    "Shoals Outdoor Sports- Florence, AL",
    "www.shoalsoutdoorsports.com"
  ].join("\n");

  Byron.constants = {
    FACEBOOK_CREATE_URL: "https://www.facebook.com/marketplace/create/vehicle",
    DESCRIPTION: description,
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
    VERSION: "0.5.2",
    // The three watermarks on every photo: a little see-through, nothing else changed.
    // Each has its own corner; the store's logo keeps the fourth (normally bottom-right).
    // If a photo has the store's logo in another corner, the watermark from that
    // corner moves to the free one, so every corner has something in it.
    WATERMARKS: [
      { file: "watermarks/no-dealer-fees.png", width: 0.34, corner: "top-left", opacity: 0.85 },
      { file: "watermarks/easy-buying.png", width: 0.25, corner: "top-right", opacity: 0.85 },
      { file: "watermarks/call-byron.png", width: 0.34, corner: "bottom-left", opacity: 0.85 }
    ],
    STORE_LOGO_CORNER: "bottom-right",
    // A small grey copy of the store's logo, used to find which corner it's in.
    STORE_LOGO_TEMPLATE: "lib/store-logo.png",
  };
})();
