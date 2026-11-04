import { useEffect, useState } from 'react';
import { money, type Unit } from '../crm/inventory';
import { describe, listOnMarketplace, rememberPayment, toListing, useLister, useListed, usePayments, type ListerInfo } from '../crm/lister';
import { prepareOwnPhoto } from '../crm/ownPhotos';
import { paymentMark } from '../crm/paymentMark';
import { useSettings } from '../crm/store';
import { Icon, Modal, when } from './kit';

/**
 * LIST ON MARKETPLACE: check the unit, its photos (with the watermarks shown
 * on top) and the description, then List on Facebook. The extension opens
 * Facebook's vehicle form and fills it; you click Publish there yourself.
 */
export function MarketplaceDialog({ u, onClose }: { u: Unit; onClose: () => void }) {
  const lister = useLister();
  const listed = useListed()[u.id];
  const max = lister ? lister.maxPhotos : 20;
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const settings = useSettings();
  const saved = usePayments()[u.id];
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? (saved ? String(saved) : '');
  const amount = Number(text.replace(/[$,\s]/g, ''));
  const payment = text.trim() && amount > 0 && amount < 100000 ? Math.round(amount * 100) / 100 : null;
  // The payment watermark for this amount (drawn here, shown in the preview, sent with the listing).
  const [mark, setMark] = useState<{ for: number; url: string } | null>(null);
  useEffect(() => {
    if (!payment) return;
    let live = true;
    const t = setTimeout(() => {
      paymentMark(payment, settings.name)
        .then((url) => live && setMark({ for: payment, url }))
        .catch((e: Error) => live && setError(`Couldn't draw the payment watermark: ${e.message}`));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [payment, settings.name]);
  const markUrl = payment && mark && mark.for === payment ? mark.url : null;
  // Your own photos (store logo already added), after the dealer's. They always
  // make the cut: when there are more than Facebook takes, dealer photos give way.
  const [own, setOwn] = useState<string[]>([]);
  const [adding, setAdding] = useState(0);
  const photos = [...u.photos, ...own];
  const ownChosen = own.filter((p) => !off.has(p)).slice(0, max);
  const chosen = [...u.photos.filter((p) => !off.has(p)).slice(0, max - ownChosen.length), ...ownChosen];
  const addOwn = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list.length) return;
    setError(null);
    setAdding(list.length);
    for (const f of list) {
      try {
        const ready = await prepareOwnPhoto(f);
        setOwn((o) => [...o, ready]);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
      setAdding((n) => n - 1);
    }
  };
  const removeOwn = (p: string) => setOwn((o) => o.filter((x) => x !== p));
  const toggle = (p: string) => setOff((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!payment || !markUrl) throw new Error('Type the monthly payment from your grid first.');
      await rememberPayment(u.id, payment);
      await listOnMarketplace(toListing(u, chosen, payment, markUrl));
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="List on Facebook Marketplace"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </button>
          {lister && !sent && (
            <button className="btn primary" disabled={busy || !chosen.length || lister.missingWatermarks || !markUrl} onClick={() => void go()}>
              <Icon name="external" size={16} /> {busy ? 'Opening Facebook…' : `List on Facebook (${chosen.length} photo${chosen.length === 1 ? '' : 's'})`}
            </button>
          )}
        </>
      }
    >
      <div className="stack mp">
        {lister === false && <InstallSteps />}
        {lister && lister.missingWatermarks && <p className="error">The extension is missing its watermark files. Reinstall the latest Torque Marketplace Lister.</p>}
        {listed && <p className="notice small">You sent this unit to Marketplace {when(listed.at)}.</p>}

        <dl className="facts">
          <dt>Vehicle type</dt>
          <dd>{lister ? lister.vehicleType : 'Other'}</dd>
          <dt>Year / make / model</dt>
          <dd>{[u.year, u.make, u.model].filter(Boolean).join(' · ') || <span className="muted">fill in on Facebook</span>}</dd>
          <dt>Price</dt>
          <dd>{u.price ? money(u.price) : <span className="error-text">No price: type it on Facebook</span>}</dd>
          <dt>Location</dt>
          <dd>{lister ? lister.location : 'Florence, Alabama'}</dd>
        </dl>

        <label className="field mp-payment">
          Monthly payment (from your grid)
          <span className="row tight">
            <span className="muted">$</span>
            <input
              inputMode="decimal"
              placeholder="100"
              value={text}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Monthly payment"
              autoFocus={!saved}
            />
            <span className="muted">per month (WAC)</span>
          </span>
          {!payment && <span className="muted small">Type it to list: it goes in the description and on the payment watermark.</span>}
        </label>

        <div className="row between">
          <h3>
            Photos <span className="muted small">{chosen.length} of {photos.length} chosen{photos.length > max ? ` (Facebook takes up to ${max})` : ''}</span>
          </h3>
          <span className="row tight">
            {own.length > 0 && u.photos.some((p) => !off.has(p)) && (
              <button className="link small" onClick={() => setOff(new Set(u.photos))}>
                Use only my photos
              </button>
            )}
            {off.size > 0 && (
              <button className="link small" onClick={() => setOff(new Set())}>
                Use all
              </button>
            )}
            <label className="btn sm">
              <Icon name="upload" size={14} /> {adding ? `Adding ${adding}…` : 'Add your own photos'}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => (void addOwn(e.target.files), (e.target.value = ''))} />
            </label>
          </span>
        </div>
        {lister && lister.watermarks.length > 0 && chosen[0] && <Preview photo={chosen[0]} lister={lister} paymentMark={markUrl} />}
        <div className="mp-photos">
          {photos.map((p, i) => {
            const on = !off.has(p) && chosen.includes(p);
            const mine = own.includes(p);
            return (
              <button key={mine ? `own-${i}` : p} className={`mp-thumb${on ? ' on' : ''}`} onClick={() => toggle(p)} title={on ? 'Leave this photo out' : 'Use this photo'}>
                <img src={p} alt={`Photo ${i + 1}${mine ? ' (yours)' : ''}`} loading="lazy" referrerPolicy="no-referrer" />
                <span className="mp-check">{on ? <Icon name="check" size={12} /> : null}</span>
                {mine && (
                  <span
                    className="mp-own"
                    role="button"
                    title="Remove this photo"
                    onClick={(e) => (e.stopPropagation(), removeOwn(p))}
                  >
                    Yours ×
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="muted small">
          The only change to the photos: your watermarks on top, arranged around the store logo. Your own photos also get the store logo in the bottom-right, the
          same one the website uses. Click a photo to leave it out.
        </p>

        <h3>Description</h3>
        <pre className="mp-desc">{lister ? describe(lister.description, payment) : 'Install the extension to see the description.'}</pre>

        {error && <p className="error">{error}</p>}
        {sent && (
          <p className="success">
            Facebook is open in a new tab and filling in the draft with your watermarked photos. Check everything there, then click Next and Publish yourself.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The first photo with the watermarks where they'll go (the store logo usually bottom-right). */
function Preview({ photo, lister, paymentMark: pm }: { photo: string; lister: ListerInfo; paymentMark: string | null }) {
  const marks = [...lister.watermarks, ...(pm && lister.paymentSpec ? [{ dataUrl: pm, spec: lister.paymentSpec }] : [])];
  return (
    <div className="mp-preview">
      <div className="mp-frame">
      <img src={photo} alt="" referrerPolicy="no-referrer" />
      {marks.map((m, i) => {
        const s = m.spec;
        const tx = /center/.test(s.anchor) ? '-50%' : /right/.test(s.anchor) ? '-100%' : '0';
        const ty = /^bottom/.test(s.anchor) ? '-100%' : /^middle/.test(s.anchor) ? '-50%' : '0';
        return (
          <img
            key={i}
            src={m.dataUrl}
            alt=""
            className="mp-mark"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.width * 100}%`, opacity: s.opacity, transform: `translate(${tx}, ${ty})` }}
          />
        );
      })}
      </div>
    </div>
  );
}

function InstallSteps() {
  return (
    <div className="notice stack tight">
      <strong>One-time setup: install the Torque Marketplace Lister in Chrome</strong>
      <ol className="small help-steps">
        <li>
          <a href="/torque-marketplace-lister.zip" download>
            Download the extension
          </a>{' '}
          and unzip it to a folder you'll keep (e.g. Documents).
        </li>
        <li>In Chrome, open chrome://extensions and turn on Developer mode (top right).</li>
        <li>Click Load unpacked and pick the unzipped folder.</li>
        <li>Reload this page. Stay logged in to Facebook in Chrome.</li>
      </ol>
    </div>
  );
}
