# Torque CRM

Byron's personal CRM for selling, built from Torque. It runs on your own Cloudflare account, so it's a web address you open from any computer or phone. There's nothing to install, and it's protected by your password.

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

## Put it on Cloudflare (one time)

Everything below is done in the Cloudflare dashboard (dash.cloudflare.com), on the same account as your Torque dialer. Torque CRM runs as a **Worker** with static assets.

1. **Database.** Create a D1 database named exactly `torque-crm` (**Storage & Databases → D1 SQL Database → Create**). Each deploy finds it by that name; there's no ID to copy.
2. **Worker.** Go to **Workers & Pages → Create → Import a repository** and pick **SaveEveryKid/torque-crm**.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`

   Every push to `main` deploys by itself.
3. **Passwords.** After the first deploy, open the **torque-crm** Worker, go to **Settings → Variables and Secrets**, and add three secrets (type *Secret*):

   | Name | Value |
   |---|---|
   | `APP_PASSWORD` | The password you'll log in with. Make it long. |
   | `DIALER_URL` | Your Torque dialer address, e.g. `https://torque-dialer.yourname.workers.dev` |
   | `DIALER_PASSWORD` | Your Torque dialer password, the same one you typed into Torque |

   Secrets take effect right away; nothing needs redeploying.
4. Open **https://torque-crm.<your-subdomain>.workers.dev** (the address on the Worker's Overview page), log in, and bookmark it. On your phone, use **Add to Home Screen**.

## Your data

- Your customers, history, tasks, call log and what Claude has learned are saved in **your own Cloudflare database (D1)**.
  - They're the same on every device you log in from.
  - Each change saves right away. The sidebar shows **All changes saved**.
  - Other devices pick up your changes when you switch back to them, and every minute.
- **Settings → Download backup** saves everything to one file, as your own copy.
  - **Restore a backup** loads that file back.
  - Restoring a backup from the **Torque Chrome extension** brings over what Claude already learned: your edits, your profile and your call log.
- **Customers → Import CSV** imports any spreadsheet with name and phone columns. A Torque **EXPORT LIST + HISTORY** file also brings each customer's eLead history.
- **Passwords stay in Cloudflare secrets.** The dialer password never reaches the browser:
  - Torque CRM's server adds it when it passes a request to your dialer.
  - Your Anthropic key stays in the dialer, as before.
- Claude only sees one customer at a time, and only when you ask it for a draft.
- Logging in gives that device a cookie that lasts 30 days. Changing `APP_PASSWORD` logs out every device.

## Inventory

The dealer's inventory page searches with Algolia, using a public search-only key built into the page. That key is limited to this dealer's units and the site renews it.

Torque CRM's server reads that page (`/dealer` in `worker/index.ts`; GET only, inventory pages only, cached for 15 minutes). Your browser then runs the same search the website does. **Refresh** re-reads the page.

## For developers

```
npm install
npm run dev:cloud  # the full app (Worker + local database) at http://127.0.0.1:8787
npm test
npm run build
```

For local secrets, create a `.dev.vars` file (it's git-ignored) with `APP_PASSWORD=...` and, optionally, `DIALER_URL` and `DIALER_PASSWORD`.

- `worker/`: the Cloudflare Worker (`index.ts` routes everything):
  - login (`/api/login`);
  - your data (`/api/data`, D1, one row per customer);
  - the dialer pass-through (`/api/dialer`), which adds the dialer password;
  - the dealer page reader (`/dealer`).

  `wrangler.jsonc` sets up the app files and the D1 database.
- `src/core/`: the Torque modules, used as they are:
  - AI drafting, the context budget, the playbook and learning;
  - the dialer session and SignalWire provider;
  - phone rules and CSV import.

  `src/core/storage/kv.ts` syncs with `/api/data` instead of using `chrome.storage`.
- `src/crm/`: the CRM data (`store.ts`), the bridge to Torque's AI (`record.ts`, `ai.ts`), the inventory reader, the dialer wiring and backups.
- `src/pages/`, `src/ui/`: the screens.
