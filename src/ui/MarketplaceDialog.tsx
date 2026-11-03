import { useState } from 'react';
import { money, type Unit } from '../crm/inventory';
import { listOnMarketplace, toListing, useLister, useListed, type ListerInfo } from '../crm/lister';
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
  const chosen = u.photos.filter((p) => !off.has(p)).slice(0, max);
  const toggle = (p: string) => setOff((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await listOnMarketplace(toListing(u, chosen));
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
            <button className="btn primary" disabled={busy || !chosen.length || lister.missingWatermarks} onClick={() => void go()}>
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

        <div className="row between">
          <h3>
            Photos <span className="muted small">{chosen.length} of {u.photos.length} chosen{u.photos.length > max ? ` (Facebook takes up to ${max})` : ''}</span>
          </h3>
          {off.size > 0 && (
            <button className="link small" onClick={() => setOff(new Set())}>
              Use all
            </button>
          )}
        </div>
        {lister && lister.watermarks.length > 0 && chosen[0] && <Preview photo={chosen[0]} lister={lister} />}
        <div className="mp-photos">
          {u.photos.map((p, i) => {
            const on = !off.has(p) && chosen.includes(p);
            return (
              <button key={p} className={`mp-thumb${on ? ' on' : ''}`} onClick={() => toggle(p)} title={on ? 'Leave this photo out' : 'Use this photo'}>
                <img src={p} alt={`Photo ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                <span className="mp-check">{on ? <Icon name="check" size={12} /> : null}</span>
              </button>
            );
          })}
        </div>
        <p className="muted small">The only change to the photos: your two watermarks on top. Click a photo to leave it out.</p>

        <h3>Description</h3>
        <pre className="mp-desc">{lister ? lister.description : 'Install the extension to see the description.'}</pre>

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

/** The first photo with the watermarks where they'll go. */
function Preview({ photo, lister }: { photo: string; lister: ListerInfo }) {
  return (
    <div className="mp-preview">
      <div className="mp-frame">
      <img src={photo} alt="" referrerPolicy="no-referrer" />
      {lister.watermarks.map((m, i) => {
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
