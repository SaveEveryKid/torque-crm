import { useEffect, useRef, useState } from 'react';
import { kv, logout, type SyncState } from '../core/storage/kv';
import { dialerAddress, dialerProvider, loadStatus, smsSetup } from '../crm/server';
import { approvePending, editProfileText, rejectPending, type StyleProfile, EMPTY_PROFILE } from '../core/storage/styleProfile';
import { aiReady, maybeProposeProfile } from '../crm/ai';
import { backupFileName, backupJson, download, restoreBackup } from '../crm/backup';
import { saveSettings, useSettings, useStoredKey } from '../crm/store';
import type { Settings } from '../crm/types';
import { copy, Icon } from '../ui/kit';

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Changes save as you type.</p>
        </div>
      </div>
      <Profile s={settings} />
      <DialerSetup s={settings} />
      <Texting />
      <Learning s={settings} />
      <Backup />
      <Account />
    </div>
  );
}

function Text({ label, k, s, type = 'text', placeholder }: { label: string; k: keyof Settings; s: Settings; type?: string; placeholder?: string }) {
  const [v, setV] = useState(String(s[k] ?? ''));
  useEffect(() => setV(String(s[k] ?? '')), [s, k]);
  return (
    <label className="field">
      {label}
      <input
        type={type}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void saveSettings({ [k]: type === 'number' ? Number(v) || 0 : v.trim() } as Partial<Settings>)}
      />
    </label>
  );
}

function Profile({ s }: { s: Settings }) {
  return (
    <section className="card card-pad stack">
      <h2>You</h2>
      <div className="form-grid">
        <Text label="Your name" k="name" s={s} />
        <Text label="Dealership" k="dealership" s={s} />
        <div className="full">
          <Text label="What you sell (Claude uses this)" k="sells" s={s} placeholder="ATVs, side-by-sides, boats…" />
        </div>
        <Text label="Follow up after (days without contact)" k="followUpDays" s={s} type="number" />
        <Text label="Dealer inventory page" k="inventoryPage" s={s} placeholder="/Inventory/All-Inventory-In-Stock" />
      </div>
    </section>
  );
}

function DialerSetup({ s }: { s: Settings }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setChecked] = useState(0);
  // Secrets added on Cloudflare since this page opened show up without a reload.
  useEffect(() => void loadStatus().then(() => setChecked((n) => n + 1)), []);
  const test = async () => {
    setBusy(true);
    setMsg(null);
    const p = dialerProvider();
    try {
      const { callerId } = await p.ping();
      let claude = '';
      try {
        await p.pingDrafts();
        claude = ' Claude is ready.';
      } catch (e) {
        claude = ` Claude isn't set up yet: ${(e as Error).message}`;
      }
      setMsg({ ok: true, text: `Connected. Calls will show ${callerId}.${claude}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad stack">
      <h2>Dialer and Claude</h2>
      <p className="soft small">
        Your Torque dialer (the Cloudflare Worker) places calls through SignalWire and asks Claude for drafts. Its address and password are set on Cloudflare (DIALER_URL and DIALER_PASSWORD
        in the Torque CRM project's settings), so the password never reaches this browser.
      </p>
      {aiReady() ? (
        <p className="success">Dialer set up: {dialerAddress()}</p>
      ) : (
        <p className="notice">Not set up yet. In Cloudflare → Workers &amp; Pages → torque-crm → Settings → Variables and Secrets, add DIALER_URL and DIALER_PASSWORD, then redeploy.</p>
      )}
      <div className="form-grid">
        <label className="field">
          Claude
          <select value={s.claudeQuality} onChange={(e) => void saveSettings({ claudeQuality: e.target.value as Settings['claudeQuality'] })}>
            <option value="fast">Fast (Haiku)</option>
            <option value="better">Best writing (Sonnet)</option>
          </select>
        </label>
        <label className="field">
          Voicemail
          <select value={s.voicemail} onChange={(e) => void saveSettings({ voicemail: e.target.value as Settings['voicemail'] })}>
            <option value="connect">Connect me — I'll leave a message</option>
            <option value="hangup">Hang up and move on</option>
          </select>
        </label>
        <Text label="Seconds between calls" k="dialDelaySeconds" s={s} type="number" />
      </div>
      <div className="row">
        <button className="btn" disabled={busy || !aiReady()} onClick={() => void test()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
    </section>
  );
}

function Texting() {
  const [, setChecked] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => void loadStatus().then(() => setChecked((n) => n + 1)), []);
  const t = smsSetup();
  return (
    <section className="card card-pad stack">
      <h2>Texting</h2>
      <p className="soft small">
        Text customers from Torque CRM through your SignalWire number. Their replies land on their timeline and in Texts. Only you press Send: nothing is ever texted automatically.
      </p>
      {t.ready ? (
        <p className="success">Texting from {t.from}.</p>
      ) : (
        <div className="notice stack tight">
          <strong>Not set up yet.</strong>
          <span>
            In Cloudflare → torque-crm → Settings → Variables and Secrets, add: <code>SW_SPACE</code> (e.g. byrongreen.signalwire.com), <code>SW_PROJECT_ID</code>, <code>SW_API_TOKEN</code>{' '}
            (Secret) and <code>SMS_FROM</code> (your number, +1…). They're the same values as in your torque-dialer Worker.
          </span>
        </div>
      )}
      {t.incomingUrl && (
        <div className="stack tight">
          <strong className="small">So replies come in: in SignalWire → Phone Numbers → your number → Messaging Settings, set “Handle messages using” to LaML Webhooks and “When a message comes in” to:</strong>
          <div className="row">
            <input readOnly value={t.incomingUrl} className="grow" onFocus={(e) => e.target.select()} />
            <button className="btn sm" onClick={() => void copy(t.incomingUrl!).then(() => setCopied(true))}>
              <Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <span className="muted small">Keep this address private. Changing your login password changes it (paste the new one into SignalWire).</span>
        </div>
      )}
    </section>
  );
}

function Learning({ s }: { s: Settings }) {
  const profile = useStoredKey<StyleProfile>('styleProfile', EMPTY_PROFILE);
  const examples = useStoredKey<unknown[]>('styleExamples', []);
  const [text, setText] = useState(profile.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(profile.text), [profile.text]);
  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      await maybeProposeProfile(s, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad stack">
      <h2>How you sell</h2>
      <p className="soft small">
        Claude learns from every draft you send: what you changed and why ({examples.length} so far). Every 10 edits it proposes an updated profile for you to OK. Restoring a backup from the Torque
        extension (below) brings over everything it already learned.
      </p>
      {profile.pending && (
        <div className="notice stack tight">
          <strong>Claude proposes an update</strong>
          <span>{profile.pending.summary}</span>
          <textarea rows={8} readOnly value={profile.pending.text} />
          <div className="row">
            <button className="btn green sm" onClick={() => void approvePending()}>
              Use it
            </button>
            <button className="btn sm" onClick={() => void rejectPending()}>
              Keep mine
            </button>
          </div>
        </div>
      )}
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="No profile yet. Write how you sell in your own words, or let Claude build one after a few edits." />
      <div className="row">
        <button className="btn sm" disabled={text === profile.text} onClick={() => void editProfileText(text)}>
          Save profile
        </button>
        <button className="btn sm" disabled={busy || !aiReady() || examples.length === 0} onClick={() => void update()}>
          <Icon name="sparkle" size={14} /> {busy ? 'Building…' : 'Update from my edits now'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Account() {
  const [sync, setSync] = useState<SyncState>(kv.sync());
  useEffect(() => kv.onSync(setSync), []);
  return (
    <section className="card card-pad stack">
      <h2>Account</h2>
      <p className="soft small">
        Your customers are saved in your own Cloudflare database, so they're the same on every computer and phone you log in from.{' '}
        {sync.status === 'error' ? <span className="warn">Not saved yet: {sync.error} (retrying)</span> : sync.status === 'saving' ? 'Saving…' : 'Everything is saved.'}
      </p>
      <div className="row">
        <button className="btn" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </section>
  );
}

function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const restore = async (f: File | undefined) => {
    if (!f) return;
    if (!confirm('Restore this backup? A Torque CRM backup replaces the customers and history on this computer. A Torque (Chrome extension) backup brings over what Claude learned.')) return;
    try {
      setMsg({ ok: true, text: await restoreBackup(await f.text()) });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    if (file.current) file.current.value = '';
  };
  return (
    <section className="card card-pad stack">
      <h2>Backup</h2>
      <p className="soft small">Your data is saved on Cloudflare. A backup file is your own copy too: download one now and then.</p>
      <div className="row">
        <button className="btn primary" onClick={() => download(backupFileName(), backupJson())}>
          <Icon name="download" size={16} /> Download backup
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void restore(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}>
          <Icon name="upload" size={16} /> Restore a backup
        </button>
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
    </section>
  );
}
