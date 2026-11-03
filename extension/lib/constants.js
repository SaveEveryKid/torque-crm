(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};

  // The description on every listing, exactly as written.
  var description = [
    "✅️ NO DEALER FEES! ✅️",
    "",
    "⏳️ Message me with any questions or to set up a time to see this unit! ⏳️",
    "",
    "‼️ Follow me on Marketplace for the best deals! ‼️",
    "",
    "🌎 Proudly serving Florence, Muscle Shoals, Tuscumbia, Sheffield, Killen, Huntsville, Decatur, Athens, Madison, and the entire Shoals area!",
    "",
    "For Sale By Dealer:",
    "",
    "👉 Message me now and let me make it easy!"
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
    VERSION: "0.2.0",
    // The two watermarks on every photo: a little see-through, nothing else changed.
    WATERMARKS: [
      // "NO DEALER FEES": top-left corner.
      { file: "watermarks/no-dealer-fees.png", width: 0.34, x: 0.025, y: 0.03, anchor: "top-left", opacity: 0.85 },
      // "Shoals Outdoor Sports · Call Byron Green 256-762-0959": bottom, centered.
      { file: "watermarks/call-byron.png", width: 0.5, x: 0.5, y: 0.97, anchor: "bottom-center", opacity: 0.85 }
    ]
  };
})();
