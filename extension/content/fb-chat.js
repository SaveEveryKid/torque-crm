(function () {
  "use strict";

  /**
   * SAVE TO TORQUE: on a Facebook Messenger chat (the popup chat windows on
   * any Facebook page, and the full-page chats at facebook.com/messages), a button that reads the buyer's name, the unit
   * they're asking about and the chat, shows it to you to fix, and saves it to
   * Torque CRM (a customer, the chat on their timeline, a task to answer).
   * Torque's Claude drafts your reply; "Put in message box" types it into
   * Facebook's message box. It never sends anything: you press Enter.
   *
   * Facebook's page code changes often, so the reading is best-effort and
   * everything it read is editable before you save.
   */
  if (window.top !== window || window.__torqueChatLoaded) return;
  window.__torqueChatLoaded = true;
  var BTN = "torque-chat-button";
  var PANEL = "torque-chat-panel";
  var FONT = "font:13px/1.4 Arial,sans-serif";

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }
  var norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };

  // Text boxes that aren't a chat: comments, posts, search.
  var NOT_CHAT = /comment|post|on your mind|write something|search|bio|caption|review|reply to/i;

  // Laid out (messages scrolled out of view in the chat still count).
  function visible(e) {
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Leaf elements with text (no element children holding text of their own). */
  function leaves(root) {
    var out = [];
    root.querySelectorAll("div, span, a, h1, h2, h3, h4, strong").forEach(function (e) {
      if (!e.firstChild || !visible(e)) return;
      for (var c = e.firstElementChild; c; c = c.nextElementSibling) if (norm(c.textContent)) return;
      var t = norm(e.textContent);
      if (t) out.push({ e: e, t: t, r: e.getBoundingClientRect() });
    });
    return out;
  }

  /**
   * Facebook's chat message box: the editable box with the "Aa" hint (its
   * label is usually "Message"). Comment and post boxes are left alone.
   */
  function isChatBox(b) {
    var r = b.getBoundingClientRect();
    if (r.width < 40 || r.height <= 0 || r.top > window.innerHeight) return false;
    var label = [b.getAttribute("aria-label"), b.getAttribute("aria-placeholder"), b.getAttribute("placeholder"), b.getAttribute("data-placeholder")].join(" ");
    if (NOT_CHAT.test(label)) return false;
    if (/message|^\s*aa\s*$/i.test(label.trim()) || /\bAa\b/.test(label)) return true;
    // The "Aa" hint is often a separate element laid over the box.
    var around = b.parentElement && b.parentElement.parentElement;
    if (around && Array.prototype.some.call(around.querySelectorAll("div, span"), function (x) { return x !== b && !x.firstElementChild && norm(x.textContent) === "Aa"; })) return true;
    return /^\/messages(\/|$)/.test(location.pathname) && !NOT_CHAT.test(label);
  }

  /**
   * The chat window around a message box: climb to the first part of the page
   * tall enough to be a chat, then widen to the whole window (same width), so
   * the header with the buyer's name is in it. Popup windows and the
   * full-page chat both work this way.
   */
  function chatOf(box) {
    var node = box;
    for (var i = 0; node.parentElement && node.parentElement !== document.body && i < 40; i += 1) {
      node = node.parentElement;
      if (node.getBoundingClientRect().height >= 250) break;
    }
    var w = node.getBoundingClientRect().width;
    while (node.parentElement && node.parentElement !== document.body) {
      var r = node.parentElement.getBoundingClientRect();
      if (r.width > w + 30 || r.height > window.innerHeight + 4) break;
      node = node.parentElement;
    }
    return node;
  }

  /** Every visible chat message box on the page, with its chat window. */
  function chats() {
    var out = [];
    document.querySelectorAll('[contenteditable="true"]').forEach(function (b) {
      if (b.closest("#" + PANEL)) return;
      if (b.parentElement && b.parentElement.closest('[contenteditable="true"]')) return;
      if (isChatBox(b)) out.push({ box: b, root: chatOf(b) });
    });
    return out;
  }

  // The chat you last typed in or clicked (when more than one is open).
  var lastBox = null;
  document.addEventListener("focusin", function (e) {
    if (e.target && e.target.isContentEditable) lastBox = e.target.closest('[contenteditable="true"]');
  }, true);

  function activeChat() {
    var all = chats();
    for (var i = 0; i < all.length; i += 1) if (all[i].box === lastBox) return all[i];
    return all[all.length - 1] || null;
  }

  function onChat() {
    return !!activeChat();
  }

  function composer() {
    var c = activeChat();
    return c ? c.box : null;
  }

  /** Facebook's id for the conversation: a /t/ link in the chat or the page address, else one made from the name and unit. */
  function threadId(root, name, unit) {
    var link = root.querySelector('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]');
    var m = (link && link.getAttribute("href").match(/\/t\/([\w.-]+)/)) || location.pathname.match(/\/t\/([\w.-]+)/);
    if (m) return m[1];
    var h = 5381, key = (name + "|" + unit).toLowerCase();
    for (var i = 0; i < key.length; i += 1) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    return name ? "p" + (h >>> 0).toString(36) : "";
  }

  var TIME_LINE = /^(today|yesterday|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s.*)?\d{1,2}:\d{2}\s*(am|pm)?$|^\d{1,2}:\d{2}\s*(am|pm)$|^\d{1,2}\/\d{1,2}\/\d{2,4}/i;
  var SKIP_LINE = /^(enter|seen|sent|delivered|you sent|you replied|you started this chat|message sent|active now|active \d+\w* ago|view buyer profile|view seller profile|view listing|mark as sold|mark as pending|mark as available|more options|marketplace|aa|reply|react|more|edited|unsent a message|you unsent a message)$/i;
  var LISTING_LINE = /^\$[\d,]+(\.\d+)?\s*[-–·]\s*(.{3,})$/;
  var clean = function (t) { return norm(String(t).replace(/[^\x20-\x7E]+/g, " ").replace(/\s*(\.\.\.|…)\s*$/, "")); };

  /** The buyer's name, the listing, and where the messages start. */
  function readHeader(root, all) {
    var top = root.getBoundingClientRect().top;
    var name = "", unit = "", startEl = null;
    var later = function (e) { if (!startEl || (startEl.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) startEl = e; };
    // "Dylan · 2025 Polaris ranger crew xp 1000 …" along the top of the chat.
    for (var i = 0; i < all.length && !name; i += 1) {
      var x = all[i];
      if (x.r.top > top + 90 || x.t.length > 200) continue;
      if (/\s[·•]\s/.test(x.t)) {
        var bits = x.t.split(/\s+[·•]\s+/);
        // "2023 Polaris Sportsman 570 · $8,999" is the listing, not a name.
        if (/^(\$|(19|20)\d{2}\s)/.test(bits[0])) {
          if (!unit) unit = bits[0];
          later(x.e);
          continue;
        }
        name = bits[0];
        unit = bits.slice(1).join(" ");
        later(x.e);
      }
    }
    for (var j = 0; j < all.length && !name; j += 1) {
      var y = all[j];
      if (y.r.top > top + 90 || y.t.length > 60 || SKIP_LINE.test(y.t) || TIME_LINE.test(y.t) || !/[a-z]/i.test(y.t) || /^(\$|(19|20)\d{2}\s)/.test(y.t)) continue;
      name = y.t;
      later(y.e);
    }
    // The Marketplace card under the header: "$24,999 - 2025 Polaris ranger crew xp 1000 …".
    all.forEach(function (z) {
      if (z.r.top > top + 220) return;
      var m = z.t.match(LISTING_LINE);
      if (m) {
        unit = m[2];
        later(z.e);
      }
      if (/^(mark as (pending|sold|available)|more options|view listing)$/i.test(z.t)) later(z.e);
    });
    return { name: clean(name), unit: clean(unit).replace(/\s*[·•-]\s*\$[\d,]+.*$/, ""), startEl: startEl };
  }

  /** "Them: …" / "Me: …" lines: which side of the chat each message sits on. */
  function readMessages(root, all, startEl, box, name) {
    var r = root.getBoundingClientRect();
    var middle = r.left + r.width / 2;
    var out = [];
    all.forEach(function (x) {
      // Between the header (and the Marketplace card) and the message box, in page order.
      if (startEl && !(startEl.compareDocumentPosition(x.e) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      if (!(x.e.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      if (TIME_LINE.test(x.t) || SKIP_LINE.test(x.t) || x.t === name || x.e.closest('[contenteditable="true"]')) return;
      if (!/[a-z0-9]/i.test(x.t)) return; // icons and emoji-only (the mic, the thumbs-up)
      var me = (x.r.left + x.r.right) / 2 > middle;
      var line = (me ? "Me: " : "Them: ") + x.t;
      if (out[out.length - 1] !== line) out.push(line);
    });
    return out.slice(-40);
  }

  function phoneIn(lines) {
    for (var i = 0; i < lines.length; i += 1) {
      if (/^Me:/.test(lines[i])) continue;
      var m = lines[i].match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      if (m) return m[0];
    }
    return "";
  }

  function read() {
    var c = activeChat();
    if (!c) return { thread: "", name: "", unit: "", phone: "", chat: "", url: location.origin + location.pathname };
    var all = leaves(c.root);
    var head = readHeader(c.root, all);
    var lines = readMessages(c.root, all, head.startEl, c.box, head.name);
    var thread = threadId(c.root, head.name, head.unit);
    var url = /^\d+$/.test(thread) ? location.origin + "/messages/t/" + thread : location.origin + location.pathname;
    return { thread: thread, name: head.name, unit: head.unit, phone: phoneIn(lines), chat: lines.join("\n"), url: url };
  }

  /* ---------- putting the reply in the message box (never sent) ---------- */

  function putInBox(text) {
    var box = composer();
    if (!box) return false;
    box.focus();
    // Facebook's editor listens for real typing: insertText is what a paste or keyboard does.
    var ok = document.execCommand("insertText", false, text);
    if (!ok || norm(box.textContent).indexOf(norm(text).slice(0, 20)) === -1) {
      box.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
    }
    return norm(box.textContent).indexOf(norm(text).slice(0, 20)) !== -1;
  }

  /* ---------- the panel ---------- */

  function input(label, value, multi) {
    var wrap = el("label", "display:block;margin:8px 0 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.05em", label);
    var f = el(multi ? "textarea" : "input", "display:block;box-sizing:border-box;width:100%;margin-top:3px;padding:6px 8px;border:1px solid #4b5563;border-radius:6px;background:#1f2937;color:#fff;" + FONT + ";text-transform:none;letter-spacing:0" + (multi ? ";height:150px;resize:vertical" : ""));
    f.value = value || "";
    wrap.appendChild(f);
    return { wrap: wrap, field: f };
  }

  function button(text, primary) {
    var b = el("button", "border:1px solid " + (primary ? "#5290c8" : "#4b5563") + ";background:" + (primary ? "#5290c8" : "#1f2937") + ";color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;" + FONT + ";font-weight:700", text);
    b.type = "button";
    return b;
  }

  function closePanel() {
    var p = document.getElementById(PANEL);
    if (p) p.remove();
  }

  function openPanel() {
    closePanel();
    var lead = read();
    var p = el("div", "position:fixed;z-index:2147483647;top:64px;right:16px;width:340px;max-height:calc(100vh - 80px);overflow:auto;padding:12px 14px;border-radius:12px;background:#111827;color:#fff;" + FONT + ";box-shadow:0 10px 30px rgba(0,0,0,.35)");
    p.id = PANEL;
    var top = el("div", "display:flex;justify-content:space-between;align-items:center");
    top.appendChild(el("div", "font-weight:700;font-size:14px", "Save to Torque"));
    var x = button("×");
    x.style.padding = "0 8px";
    x.addEventListener("click", closePanel);
    top.appendChild(x);
    p.appendChild(top);
    p.appendChild(el("div", "color:#9ca3af;margin-top:2px", "Check what was read from this chat. Fix anything, then save."));
    var name = input("Name", lead.name);
    var phone = input("Phone (if they gave one)", lead.phone);
    var unit = input("Unit they're asking about", lead.unit);
    var chat = input("Chat (Them: / Me: lines)", lead.chat, true);
    [name, phone, unit, chat].forEach(function (f) { p.appendChild(f.wrap); });
    if (!lead.chat) p.appendChild(el("div", "color:#fbbf24;margin-top:6px", "Couldn't read the messages on this page. Paste the chat above (Them: … / Me: …), or just save the name."));
    var status = el("div", "margin-top:10px;color:#d1d5db");
    var row = el("div", "display:flex;gap:8px;margin-top:10px");
    var save = button("Save to Torque", true);
    row.appendChild(save);
    p.appendChild(row);
    p.appendChild(status);
    document.body.appendChild(p);

    save.addEventListener("click", function () {
      var data = { thread: lead.thread, name: norm(name.field.value), phone: norm(phone.field.value), unit: norm(unit.field.value), chat: chat.field.value, url: lead.url };
      save.disabled = true;
      save.textContent = "Saving…";
      status.textContent = "Saving to Torque and writing a reply (about 10–20 seconds)…";
      chrome.runtime.sendMessage({ type: "SAVE_CHAT", lead: data }, function (r) {
        save.disabled = false;
        save.textContent = "Save again";
        if (chrome.runtime.lastError || !r || !r.ok) {
          status.style.color = "#fca5a5";
          status.textContent = (r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "Couldn't reach Torque.";
          return;
        }
        showResult(p, status, r.result, r.crm);
      });
    });
  }

  function showResult(p, status, res, crm) {
    status.style.color = "#86efac";
    status.textContent = "";
    var what = res.isNew ? "New customer: " + res.name : res.added ? "Added to " + res.name : res.name + " (already up to date)";
    status.appendChild(document.createTextNode("✓ " + what + (res.unit ? " · " + res.unit : "") + " "));
    var open = el("a", "color:#93c5fd", "Open in Torque");
    open.href = (crm || "https://torque-crm.byrongreen2012.workers.dev") + "/#/customers/" + encodeURIComponent(res.customerId);
    open.target = "_blank";
    open.rel = "noopener";
    status.appendChild(open);
    var old = p.querySelector("[data-torque-reply]");
    if (old) old.remove();
    var box = el("div", "margin-top:10px;border-top:1px solid #374151;padding-top:8px");
    box.setAttribute("data-torque-reply", "");
    if (res.reply) {
      if (res.gate) box.appendChild(el("div", "color:#9ca3af;font-size:12px;margin-bottom:4px", res.gate));
      var reply = input("Your reply (edit if you like)", res.reply, true);
      reply.field.style.height = "90px";
      box.appendChild(reply.wrap);
      if (res.note) box.appendChild(el("div", "color:#fbbf24;font-size:12px;margin-top:4px", res.note));
      var row = el("div", "display:flex;gap:8px;margin-top:8px");
      var put = button("Put in message box", true);
      var copy = button("Copy");
      put.addEventListener("click", function () {
        var ok = putInBox(reply.field.value);
        put.textContent = ok ? "In the box: press Enter to send" : "Couldn't: use Copy";
      });
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(reply.field.value).then(function () { copy.textContent = "Copied"; });
      });
      row.appendChild(put);
      row.appendChild(copy);
      box.appendChild(row);
    } else if (res.replyError) {
      box.appendChild(el("div", "color:#fbbf24", res.replyError));
    }
    p.appendChild(box);
  }

  /* ---------- the button (Facebook changes pages without reloading: check every second) ---------- */

  function tick() {
    var b = document.getElementById(BTN);
    if (!onChat()) {
      if (b) b.remove();
      return;
    }
    if (b) return;
    b = el("button", "position:fixed;z-index:2147483646;top:64px;right:16px;border:0;border-radius:999px;padding:8px 14px;background:#5290c8;color:#fff;" + FONT + ";font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)", "Save to Torque");
    b.id = BTN;
    b.type = "button";
    b.title = "Save this buyer and chat to Torque CRM, and get a reply drafted";
    b.addEventListener("click", openPanel);
    document.body.appendChild(b);
  }

  // Clicking the extension's icon in Chrome's toolbar opens the panel too (even if the button didn't show).
  chrome.runtime.onMessage.addListener(function (m, sender, reply) {
    if (m && m.type === "TORQUE_OPEN_CHAT_PANEL") {
      openPanel();
      reply({ ok: true });
    }
  });

  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      closePanel(); // a different chat
    }
    tick();
  }, 1000);
  tick();
})();
