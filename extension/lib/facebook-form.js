(function () {
  "use strict";

  var root = typeof self !== "undefined" ? self : window;
  var Byron = root.Byron = root.Byron || {};
  var utils = Byron.utils;

  function visible(element) {
    if (!element) return false;
    var style = getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function labelText(element) {
    if (!element) return "";
    var aria = element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name") || "";
    if (element.tagName === "BUTTON" || element.getAttribute("role") === "button" || element.getAttribute("role") === "combobox") {
      aria += " " + (element.textContent || "");
    }
    var labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) aria += " " + labelledBy.split(/\s+/).map(function (id) {
      var label = document.getElementById(id);
      return label ? label.textContent : "";
    }).join(" ");
    var parent = element.closest("label");
    if (parent) aria += " " + parent.textContent;
    return utils.normalizeText(aria);
  }

  function matchesLabel(element, labels) {
    var text = labelText(element).toLowerCase();
    return labels.some(function (label) { return text.indexOf(String(label).toLowerCase()) !== -1; });
  }

  function allControls() {
    return Array.from(document.querySelectorAll('input, textarea, [role="textbox"], [role="combobox"], button'))
      .filter(visible);
  }

  function findControl(labels) {
    var controls = allControls();
    var direct = controls.find(function (control) { return matchesLabel(control, labels); });
    if (direct) return direct;

    var labelElements = Array.from(document.querySelectorAll("label, [role=label], span, div"))
      .filter(visible)
      .filter(function (element) {
        var text = utils.normalizeText(element.textContent).toLowerCase();
        return labels.some(function (label) { return text === String(label).toLowerCase(); });
      });
    for (var i = 0; i < labelElements.length; i += 1) {
      var label = labelElements[i];
      var forId = label.getAttribute("for");
      if (forId && document.getElementById(forId)) return document.getElementById(forId);
      var nearby = label.parentElement && label.parentElement.querySelector("input, textarea, [role=combobox], [role=textbox], button");
      if (nearby && visible(nearby)) return nearby;
    }
    return null;
  }

  function findFileInput() {
    return Array.from(document.querySelectorAll('input[type="file"]')).find(visible) ||
      document.querySelector('input[type="file"]');
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    var prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, "value");
    if (setter && setter.set) setter.set.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function clickElement(element) {
    if (!element) return false;
    element.click();
    return true;
  }

  function clickText(labels) {
    var elements = Array.from(document.querySelectorAll("button, [role=button], [role=option], div, span"))
      .filter(visible)
      .filter(function (element) {
        var text = utils.normalizeText(element.textContent).toLowerCase();
        return labels.some(function (label) { return text === String(label).toLowerCase(); });
      });
    return clickElement(elements[0]);
  }

  async function waitFor(predicate, timeout, label) {
    var end = Date.now() + (timeout || 30000);
    while (Date.now() < end) {
      var result = predicate();
      if (result) return result;
      await utils.sleep(250);
    }
    throw new Error(label || "Timed out waiting for Facebook Marketplace.");
  }

  async function setText(labels, value, required) {
    var control = await waitFor(function () { return findControl(labels); }, 15000, "Could not find field: " + labels[0]);
    if (control.tagName === "BUTTON" || control.getAttribute("role") === "combobox") {
      clickElement(control);
      await utils.sleep(150);
      clickText([String(value)]);
      return { field: labels[0], method: "dropdown", value: value };
    }
    setNativeValue(control, value);
    return { field: labels[0], method: "text", value: value };
  }

  async function setIfPresent(labels, value) {
    var control = findControl(labels);
    if (!control) return { field: labels[0], skipped: true };
    if (control.tagName === "BUTTON" || control.getAttribute("role") === "combobox") {
      clickElement(control);
      await utils.sleep(150);
      clickText([String(value)]);
      return { field: labels[0], method: "dropdown", value: value };
    }
    setNativeValue(control, value);
    return { field: labels[0], method: "text", value: value };
  }

  async function ensureVehicleMode() {
    if (/\/create\/vehicle/i.test(location.pathname)) return true;
    var clicked = clickText(["Vehicle", "Vehicle for sale"]);
    if (clicked) await utils.sleep(500);
    return clicked;
  }

  async function uploadFiles(files) {
    var input = findFileInput();
    if (!input) {
      clickText(["Add photos", "Add Photos", "Photos", "Add photo"]);
      input = await waitFor(findFileInput, 15000, "Photo upload input did not appear.");
    }
    var transfer = new DataTransfer();
    files.forEach(function (file) { transfer.items.add(file); });
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return files.length;
  }

  Byron.facebookForm = {
    visible: visible,
    findControl: findControl,
    findFileInput: findFileInput,
    setNativeValue: setNativeValue,
    clickText: clickText,
    waitFor: waitFor,
    setText: setText,
    setIfPresent: setIfPresent,
    ensureVehicleMode: ensureVehicleMode,
    uploadFiles: uploadFiles
  };
})();
