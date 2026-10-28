# Torque CRM

Byron's personal CRM for selling, built from Torque. It's a web app that runs on your own computer, in your browser. It's not a Chrome extension and doesn't use eLead.

- **Today:** what's due, your appointments this week, and who needs a follow-up.
- **Customers:** everyone you're working. Each customer page has:
  - a timeline of texts, calls, emails, visits and notes;
  - next steps and appointments (mark Showed or No-show);
  - the vehicle they're looking at.
- **Pipeline:** drag customers from New to Contacted, Appointment, Showed, Working deal and Sold.
- **Inventory:** in-stock units from [Shoals Outdoor Sports](https://www.shoalsoutdoorsports.com/Inventory/All-Inventory-In-Stock). Search, filter and sort them, then attach a unit to a customer.
- **Claude:** writes follow-ups (a text and an email) in your voice, using the Three Gates playbook from Torque.
  - It can also reply to a customer's last message, and write appointment confirmation, day-of and no-show texts.
  - You copy and send each one yourself, then click **Mark sent**.
  - What you change teaches it. Every 10 edits it proposes an updated "How I sell" profile.
- **Dialer:** the same power dialer as Torque, through your SignalWire number.
  - Calls go one at a time. Nothing is prerecorded and there's no AI voice.
  - Voicemail can either connect you or hang up.
  - The Call button on a customer's page calls just that person.
  - Every result goes on the customer's timeline.

## Start it

1. Install **Node.js** (the LTS version) from https://nodejs.org. You only do this once.
2. Download this repository and unzip it somewhere, such as `Documents\Torque CRM`.
3. Double-click **Start Torque CRM.bat** (Windows) or **Start Torque CRM.command** (Mac).
   - The first start installs what it needs, which takes about a minute.
   - The app then opens at **http://localhost:5180**. Bookmark it.
   - Leave the black window open while you work. Close it when you're done.

## Your data

- Everything is kept in your browser on this computer, at `http://localhost:5180`. Always use that same address and the same browser.
- **Settings → Download backup** saves everything to one file. The dialer password is never put in a backup.
  - Restore that file on a new computer.
  - Restoring a backup from the **Torque Chrome extension** brings over what Claude already learned: your edits, your profile and your call log.
- **Customers → Import CSV** imports any spreadsheet with name and phone columns. A Torque **EXPORT LIST + HISTORY** file also brings each customer's eLead history.
- Claude only sees one customer at a time, and only when you ask it for a draft. Requests go through your own dialer, where your Anthropic key stays.

## Setup in Settings

Use the same dialer address and password as Torque. Your Cloudflare Worker handles calls through SignalWire and drafts through Claude. Then click **Test connection**.

## Inventory

The dealer's inventory page searches with Algolia, using a public search-only key built into the page. That key is limited to this dealer's units and the site renews it. Torque CRM reads the page through its local server (`/dealer`, see `vite.config.ts`), then runs the same search the website does. **Refresh** re-reads the page.

## For developers

```
npm install
npm run dev        # http://localhost:5180 with hot reload
npm test
npm run build
```

- `src/core/`: the Torque modules, used as they are:
  - AI drafting, the context budget, the playbook and learning;
  - the dialer session and SignalWire provider;
  - phone rules and CSV import.

  Storage is IndexedDB (`src/core/storage/kv.ts`) instead of `chrome.storage`.
- `src/crm/`: the CRM data (`store.ts`), the bridge to Torque's AI (`record.ts`, `ai.ts`), the inventory reader, the dialer wiring and backups.
- `src/pages/`, `src/ui/`: the screens.
