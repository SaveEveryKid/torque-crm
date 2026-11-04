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

  /**
   * Long text (the description): typed in like a person would, once. Focus the
   * box, select what's there and insert the text, so Facebook's own editor
   * handles it (no fake blur, no repeated events). Left alone if it already
   * says exactly that.
   */
  function typeText(element, value) {
    if (!element) return false;
    var text = String(value);
    var current = element.value != null ? element.value : element.textContent;
    if (text && utils.normalizeText(current) === utils.normalizeText(text)) return true;
    element.focus();
    var typed = false;
    try {
      if (typeof element.select === "function") element.select();
      else document.execCommand("selectAll", false);
      typed = document.execCommand("insertText", false, text);
    } catch (e) {
      typed = false;
    }
    var now = element.value != null ? element.value : element.textContent;
    if (!typed || utils.normalizeText(now) !== utils.normalizeText(text)) {
      var prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(prototype, "value");
      if (element.value != null && setter && setter.set) setter.set.call(element, text);
      else if (element.value != null) element.value = text;
      else element.textContent = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
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

  /** A click the way a mouse does it (Facebook's menus listen for the pointer/mouse events, not just click). */
  function fullClick(element) {
    if (!element) return false;
    if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center" });
    var r = element.getBoundingClientRect();
    var at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
      var E = /^pointer/.test(type) && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      element.dispatchEvent(new E(type, Object.assign({ pointerId: 1, isPrimary: true }, at)));
    });
    return true;
  }

  function controlText(control) {
    return utils.normalizeText(control.value != null && control.tagName === "INPUT" ? control.value : control.textContent);
  }

  /**
   * Waits for the open list and clicks the entry that matches. Long lists (the
   * years) only show some rows at a time, so it scrolls down through them.
   */
  async function pickOption(matches, timeout) {
    var end = Date.now() + (timeout || 8000);
    while (Date.now() < end) {
      var options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [role="menuitemradio"]')).filter(visible);
      var hit = options.find(function (o) { return matches(utils.normalizeText(o.textContent)); });
      if (hit) {
        fullClick(hit);
        return utils.normalizeText(hit.textContent);
      }
      var box = Array.from(document.querySelectorAll('[role="listbox"]')).filter(visible).find(function (b) {
        return b.scrollHeight > b.clientHeight + 2 && b.scrollTop + b.clientHeight < b.scrollHeight - 2;
      });
      if (options.length && box) box.scrollTop += Math.max(40, box.clientHeight * 0.8);
      await utils.sleep(150);
    }
    return null;
  }

  /**
   * A dropdown (Vehicle type, Year): open it, wait for the list, click the
   * exact entry, and check it took. Nothing for you to pick by hand.
   */
  async function chooseFromDropdown(labels, value, timeout) {
    var want = utils.normalizeText(String(value)).toLowerCase();
    var control = await waitFor(function () { return findControl(labels); }, timeout || 8000, "").catch(function () { return null; });
    if (!control) return { field: labels[0], skipped: true };
    for (var attempt = 0; attempt < 2; attempt += 1) {
      if (controlText(control).toLowerCase().split(/\s+/).indexOf(want) !== -1 || controlText(control).toLowerCase() === want) {
        return { field: labels[0], method: "dropdown", value: value };
      }
      fullClick(control);
      var picked = await pickOption(function (t) { return t.toLowerCase() === want; }, 8000);
      await utils.sleep(300);
      if (picked && (controlText(control).toLowerCase().indexOf(want) !== -1 || !document.contains(control))) {
        return { field: labels[0], method: "dropdown", value: value };
      }
      control = findControl(labels) || control;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { field: labels[0], skipped: true };
  }

  /**
   * A typeahead (Location): clear it, type the place, wait for Facebook's
   * suggestions and click the one in the right state ("Florence, AL", not
   * Florence, KY).
   */
  async function chooseFromTypeahead(labels, place) {
    var control = findControl(labels);
    if (!control) return { field: labels[0], skipped: true };
    var input = control.tagName === "INPUT" ? control : control.querySelector("input") || control;
    var parts = place.split(",");
    var town = utils.normalizeText(parts[0]).toLowerCase();
    var state = utils.normalizeText(parts[1] || "").toLowerCase();
    var abbr = { alabama: "al" }[state] || "";
    var right = function (t) {
      var s = t.toLowerCase();
      if (s.indexOf(town) === -1) return false;
      if (!state) return true;
      return s.indexOf(state) !== -1 || (abbr && new RegExp("\\b" + abbr + "\\b").test(s));
    };
    var tries = [place, parts[0]];
    for (var i = 0; i < tries.length; i += 1) {
      fullClick(input);
      typeText(input, "");
      typeText(input, tries[i]);
      var picked = await pickOption(right, 8000);
      if (picked) {
        await utils.sleep(300);
        return { field: labels[0], method: "typeahead", value: picked, picked: true };
      }
    }
    return { field: labels[0], method: "typeahead", value: place, picked: false };
  }

  /** The description: a long text box, typed in once. */
  async function setLongText(labels, value) {
    var control = findControl(labels);
    if (!control) return { field: labels[0], skipped: true };
    typeText(control, value);
    return { field: labels[0], method: "typed", value: value };
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
    setLongText: setLongText,
    fullClick: fullClick,
    pickOption: pickOption,
    chooseFromDropdown: chooseFromDropdown,
    chooseFromTypeahead: chooseFromTypeahead,
    typeText: typeText,
    ensureVehicleMode: ensureVehicleMode,
    uploadFiles: uploadFiles
  };
})();
