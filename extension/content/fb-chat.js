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
  if (window.top !== window) return;
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
  var NOT_CHAT = /comment|post|on your mind|write something|search|bio|caption|review/i;

  /**
   * The chat a message box belongs to: the nearest part of the page around it
   * that has messages in it, widened to the whole chat window (so the header
   * with the buyer's name is included). Works for the full-page chats
   * (facebook.com/messages) and the small popup chat windows on any page.
   */
  function chatOf(box) {
    var full = /^\/(messages|marketplace)(\/|$)/.test(location.pathname) && box.closest('[role="main"]');
    if (full) return full;
    var node = box.parentElement;
    for (var i = 0; node && i < 25 && !node.querySelector('[role="row"]'); i += 1) node = node.parentElement;
    if (!node || !node.querySelector('[role="row"]')) return null;
    var w = node.getBoundingClientRect().width;
    while (node.parentElement && node.parentElement !== document.body) {
      var r = node.parentElement.getBoundingClientRect();
      if (r.width > w + 24 || r.height > window.innerHeight) break;
      node = node.parentElement;
    }
    return node;
  }

  /** Every visible chat message box on the page, with its chat. */
  function chats() {
    var out = [];
    document.querySelectorAll('[role="textbox"][contenteditable="true"]').forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.width < 100 || r.height <= 0) return;
      var label = [b.getAttribute("aria-label"), b.getAttribute("aria-placeholder"), b.getAttribute("placeholder")].join(" ");
      if (NOT_CHAT.test(label)) return;
      var root = chatOf(b);
      if (root) out.push({ box: b, root: root });
    });
    return out;
  }

  // The chat you last typed in or clicked (when more than one is open).
  var lastBox = null;
  document.addEventListener("focusin", function (e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute("role") === "textbox") lastBox = e.target;
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

  var TIME_LINE = /^(today|yesterday|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s.*\d{1,2}:\d{2}\s*(am|pm)?$|^\d{1,2}:\d{2}\s*(am|pm)$/i;
  var SKIP_LINE = /^(enter|seen|sent|delivered|you sent|you replied|you started this chat|message sent|active now|active \d+\w* ago|view buyer profile|view seller profile|mark as sold|mark as pending)\b/i;

  /** "Them: …" / "Me: …" lines: which side of the pane each message bubble sits on. */
  function readMessages(root) {
    var box = root.getBoundingClientRect();
    var middle = box.left + box.width / 2;
    var rows = root.querySelectorAll('[role="row"]');
    var out = [];
    var seen = new Set();
    rows.forEach(function (row) {
      var parts = [];
      var first = null;
      row.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(function (n) {
        if (n.querySelector('[dir="auto"]')) return; // the innermost text only
        var t = norm(n.textContent);
        if (!t || TIME_LINE.test(t) || SKIP_LINE.test(t)) return;
        if (!first) first = n;
        if (parts.indexOf(t) === -1) parts.push(t);
      });
      if (!parts.length || !first) return;
      var r = first.getBoundingClientRect();
      if (!r.width) return;
      var me = (r.left + r.right) / 2 > middle;
      var line = (me ? "Me: " : "Them: ") + parts.join(" ");
      if (seen.has(line)) return;
      seen.add(line);
      out.push(line);
    });
    return out.slice(-40);
  }

  var UNIT = /\b(19|20)\d{2}\s+[A-Za-z][\w&.'-]*(\s+[\w&.'/-]+){0,7}/;

  /** The buyer's name and the listing, from the conversation's header ("Jane · 2024 Polaris Ranger 1000"). */
  function readHeader(root) {
    var name = "";
    var unit = "";
    var heads = root.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (var i = 0; i < heads.length && !name; i += 1) {
      var t = norm(heads[i].textContent);
      if (!t || t.length > 120 || /^(chats|messages|marketplace|inbox|chat info)$/i.test(t)) continue;
      var bits = t.split(/\s+[·•|]\s+/);
      name = bits[0];
      if (bits.length > 1) unit = bits.slice(1).join(" · ");
    }
    if (!name) {
      // Popup chat windows: the name is the first short text along the top of the window.
      var top = root.getBoundingClientRect().top;
      var tops = root.querySelectorAll("span, a, h4, strong");
      for (var k = 0; k < tops.length && !name; k += 1) {
        var r = tops[k].getBoundingClientRect();
        var w = norm(tops[k].textContent);
        if (!w || w.length > 120 || !r.width || r.top < top - 2 || r.bottom > top + 80) continue;
        if (/^(active|close|minimize|options|chat|messenger|marketplace|seen|new message)\b/i.test(w) || !/[a-z]/i.test(w)) continue;
        var parts = w.split(/\s+[·•|]\s+/);
        name = parts[0];
        if (parts.length > 1) unit = parts.slice(1).join(" · ");
      }
    }
    if (!unit) {
      // The listing card at the top of a Marketplace chat (e.g. "2024 Polaris Ranger 1000 · $15,999").
      var spans = root.querySelectorAll('span, a[role="link"]');
      for (var j = 0; j < spans.length && !unit; j += 1) {
        var s = norm(spans[j].textContent);
        if (s.length < 8 || s.length > 100) continue;
        var m = s.match(UNIT);
        if (m) unit = norm(m[0].replace(/\s*[·•]\s*\$.*$/, ""));
      }
    }
    return { name: name.replace(/\s*\(.*\)$/, ""), unit: unit.replace(/\s*[·•-]\s*\$[\d,]+.*$/, "") };
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
    var root = c ? c.root : document.body;
    var head = readHeader(root);
    var lines = readMessages(root);
    var thread = threadId(root, head.name, head.unit);
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
