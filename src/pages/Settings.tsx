import { useEffect, useRef, useState } from 'react';
import { TwilioDialerProvider, twilioBaseOk } from '../core/dialer/twilioProvider';
import { approvePending, editProfileText, rejectPending, type StyleProfile, EMPTY_PROFILE } from '../core/storage/styleProfile';
import { aiReady, maybeProposeProfile } from '../crm/ai';
import { backupFileName, backupJson, download, restoreBackup } from '../crm/backup';
import { saveSettings, useSettings, useStoredKey } from '../crm/store';
import type { Settings } from '../crm/types';
import { Icon } from '../ui/kit';

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Everything is saved on this computer as you type.</p>
        </div>
      </div>
      <Profile s={settings} />
      <DialerSetup s={settings} />
      <Learning s={settings} />
      <Backup />
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
        <Text label="Follow up after (days without contact)" k="followUpDays" s={s} type="number" />
        <Text label="Dealer inventory page" k="inventoryPage" s={s} placeholder="/Inventory/All-Inventory-In-Stock" />
      </div>
    </section>
  );
}

function DialerSetup({ s }: { s: Settings }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setMsg(null);
    const p = new TwilioDialerProvider(s.dialerUrl, s.dialerPassword);
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
      <p className="soft small">Your Torque dialer (the Cloudflare Worker) places calls through SignalWire and asks Claude for drafts. Your keys stay in the Worker.</p>
      <div className="form-grid">
        <div className="full">
          <Text label="Dialer address" k="dialerUrl" s={s} placeholder="https://torque-dialer.yourname.workers.dev" />
        </div>
        <Text label="Dialer password" k="dialerPassword" s={s} type="password" />
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
        <button className="btn" disabled={busy || !twilioBaseOk(s.dialerUrl) || !s.dialerPassword} onClick={() => void test()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        {!aiReady(s) && <span className="muted small">The password is at least 16 characters.</span>}
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
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
        <button className="btn sm" disabled={busy || !aiReady(s) || examples.length === 0} onClick={() => void update()}>
          <Icon name="sparkle" size={14} /> {busy ? 'Building…' : 'Update from my edits now'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
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
      <p className="soft small">Your data lives in this browser on this computer. Save a backup now and then (the dialer password is never included).</p>
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
