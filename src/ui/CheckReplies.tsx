import { useRef, useState } from 'react';
import { kv } from '../core/storage/kv';
import { scanInbox, type ScanSummary } from '../crm/replyScan';
import { useStoredKey } from '../crm/store';
import { go, Icon, when } from './kit';

/**
 * CHECK FOR REPLIES: drop your exported Outlook Inbox (.pst). It's read here
 * in your browser; only replies, bounces and auto-replies from your customers
 * are saved to the CRM.
 */
export function CheckReplies() {
  const last = useStoredKey<{ at: string; read: number; found: number } | null>('replyScan', null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ScanSummary | null>(null);
  const [drag, setDrag] = useState(false);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setRes(null);
    setBusy(0);
    try {
      const r = await scanInbox(file, (n) => setBusy(n));
      setRes(r);
      await kv.set({ replyScan: { at: new Date().toISOString(), read: r.read, found: r.found.length } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const replies = res?.found.filter((f) => f.kind === 'reply') ?? [];
  const bounces = res?.found.filter((f) => f.kind === 'bounce') ?? [];
  const autos = res?.found.filter((f) => f.kind === 'auto') ?? [];

  return (
    <section className="card card-pad stack check-replies">
      <div className="row between">
        <h2 className="row">
          <Icon name="mail" /> Check for replies
        </h2>
        <span className="muted small">{last ? `Last checked ${when(last.at)}` : 'Not checked yet'}</span>
      </div>
      <input ref={input} type="file" accept=".pst,.ost" hidden onChange={(e) => void run(e.target.files?.[0])} />
      <div
        className={`dropzone small-zone${drag ? ' on' : ''}`}
        onClick={() => busy === null && input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), void run(e.dataTransfer.files[0]))}
      >
        {busy !== null ? (
          <strong>Reading your inbox… {busy ? `${busy.toLocaleString()} emails` : ''}</strong>
        ) : (
          <>
            <strong>Drop your exported Inbox (.pst) here</strong>
            <span className="soft small">Read on this computer; only emails from your customers are saved.</span>
          </>
        )}
      </div>
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setHelp((x) => !x)}>
        {help ? 'Hide' : 'How do I export my Inbox?'}
      </button>
      {help && (
        <ol className="small soft help-steps">
          <li>In Outlook: File → Open and export → Import/Export.</li>
          <li>Export to Outlook Data File (.pst) → pick Inbox (Include subfolders on) → Next → save it (e.g. to Desktop).</li>
          <li>Drop that file here. You can delete it afterwards.</li>
        </ol>
      )}
      {error && <p className="error">{error}</p>}
      {res && (
        <div className="stack tight">
          <p className={replies.length ? 'success' : 'notice'}>
            Read {res.read.toLocaleString()} emails: {replies.length} new repl{replies.length === 1 ? 'y' : 'ies'}
            {bounces.length ? `, ${bounces.length} bounced` : ''}
            {autos.length ? `, ${autos.length} out-of-office` : ''}.{replies.length ? ' They’re under Needs a reply, and their follow-ups stopped.' : ''}
          </p>
          {[...replies, ...bounces].map((f) => (
            <button key={f.mail.id + f.customerId} className="link small" style={{ textAlign: 'left' }} onClick={() => go(`customers/${f.customerId}`)}>
              {f.kind === 'bounce' ? 'Bounced: ' : 'Reply: '}
              {f.name} · {f.mail.subject || '(no subject)'}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
