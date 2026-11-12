import { useEffect, useState } from 'react';
import { money, type Unit } from '../crm/inventory';
import { listingDescription, listOnEbay, milesOf, listOnMarketplace, listOnOfferUp, MIN_EXTENSION, MIN_EXTENSION_EBAY, MIN_EXTENSION_OFFERUP, olderThan, rememberPayment, toListing, useLister, useListed, usePayments, type ListerInfo } from '../crm/lister';
import { accessoryBlock, useUnitAccessories } from '../crm/accessories';
import { saveBlurb, useBlurbs, writeBlurb } from '../crm/blurb';
import { aiReady } from '../crm/ai';
import { prepareOwnPhoto } from '../crm/ownPhotos';
import { paymentMark } from '../crm/paymentMark';
import { useSettings } from '../crm/store';
import { Icon, Modal, when } from './kit';

/**
 * LIST ON MARKETPLACE: check the unit, its photos (with the watermarks shown
 * on top) and the description, then List on Facebook. The extension opens
 * Facebook's vehicle form and fills it; you click Publish there yourself.
 */
export function MarketplaceDialog({ u, onClose, site = 'facebook' }: { u: Unit; onClose: () => void; site?: 'facebook' | 'offerup' | 'ebay' }) {
  const lister = useLister();
  const offerup = site === 'offerup';
  const ebay = site === 'ebay';
  const where = offerup ? 'OfferUp' : ebay ? 'eBay' : 'Facebook';
  const needs = offerup ? MIN_EXTENSION_OFFERUP : ebay ? MIN_EXTENSION_EBAY : MIN_EXTENSION;
  const listed = useListed(site)[u.id];
  const max = offerup ? (lister && lister.offerup ? lister.offerup.maxPhotos : 12) : ebay ? (lister && lister.ebay ? lister.ebay.maxPhotos : 24) : lister ? lister.maxPhotos : 20;
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const settings = useSettings();
  const accessories = accessoryBlock(useUnitAccessories()[u.id] ?? [], u.price);
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
  // The short product blurb at the top: saved per unit; Claude writes it the first time.
  const savedBlurb = useBlurbs()[u.id];
  const [blurb, setBlurb] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const shown = blurb ?? savedBlurb ?? '';
  const rewrite = async () => {
    setWriting(true);
    try {
      const b = await writeBlurb(u, settings);
      setBlurb(b);
      await saveBlurb(u.id, b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWriting(false);
    }
  };
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (asked || savedBlurb !== undefined || blurb !== null || !aiReady()) return;
    setAsked(true);
    void rewrite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBlurb, asked, blurb]);
  // The description, written here (blurb, accessories and total included); the extension types it exactly.
  const description = listingDescription(payment, accessories, settings.name, shown);
  const outdated = !!lister && olderThan(lister.version, needs);
  const toggle = (p: string) => setOff((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!payment || !markUrl) throw new Error('Type the monthly payment from your grid first.');
      await rememberPayment(u.id, payment);
      await (offerup ? listOnOfferUp : ebay ? listOnEbay : listOnMarketplace)(toListing(u, chosen, payment, markUrl, accessories, description));
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
      title={offerup ? 'List on OfferUp' : ebay ? 'List on eBay Motors (local classified ad)' : 'List on Facebook Marketplace'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </button>
          {lister && !sent && (
            <button className="btn primary" disabled={busy || !chosen.length || lister.missingWatermarks || !markUrl || outdated} onClick={() => void go()}>
              <Icon name="external" size={16} /> {busy ? `Opening ${where}…` : `List on ${where} (${chosen.length} photo${chosen.length === 1 ? '' : 's'})`}
            </button>
          )}
        </>
      }
    >
      <div className="stack mp">
        {lister === false && <InstallSteps />}
        {outdated && <InstallSteps update={lister.version} needs={needs} />}
        {lister && lister.missingWatermarks && <p className="error">The extension is missing its watermark files. Reinstall the latest Torque Marketplace Lister.</p>}
        {listed && <p className="notice small">You sent this unit to {offerup ? 'OfferUp' : ebay ? 'eBay' : 'Marketplace'} {when(listed.at)}.</p>}

        <dl className="facts">
          <dt>{offerup || ebay ? (ebay ? 'Format' : 'Category') : 'Vehicle type'}</dt>
          <dd>{offerup ? 'Vehicles' : ebay ? 'Local classified ad (you pick the eBay Motors category)' : lister ? lister.vehicleType : 'Powersport'}</dd>
          <dt>Year / make / model</dt>
          <dd>{[u.year, u.make, u.model].filter(Boolean).join(' · ') || <span className="muted">fill in on {where}</span>}</dd>
          <dt>Price</dt>
          <dd>{u.price ? money(u.price) : <span className="error-text">No price: type it on {where}</span>}</dd>
          <dt>Location</dt>
          <dd>{offerup || ebay ? 'ZIP 35634 (Florence, AL)' : lister ? lister.location : 'Florence, Alabama'}</dd>
          {ebay && (
            <>
              <dt>VIN / miles</dt>
              <dd>
                {u.vin || <span className="muted">no VIN: type it on eBay</span>} · {milesOf(u) ?? <span className="muted">miles: type on eBay</span>}
                {milesOf(u) != null ? ' mi' : ''}
              </dd>
            </>
          )}
          {!offerup && !ebay && (
            <>
              <dt>Color / fuel</dt>
              <dd>
                {u.color ? `${u.color} (exterior)` : <span className="muted">exterior color: pick on Facebook</span>} · black interior · {/kinetic|electric/i.test(u.title) ? 'electric' : 'gasoline'}
              </dd>
            </>
          )}
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
            Photos <span className="muted small">{chosen.length} of {photos.length} chosen{photos.length > max ? ` (${where} takes up to ${max})` : ''}</span>
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

        <label className="field">
          <span className="row between">
            <span>Short description (top of the listing)</span>
            <button className="link small" disabled={writing || !aiReady()} onClick={() => void rewrite()} title={aiReady() ? 'Have Claude write it again' : 'Claude needs your dialer set up (Settings)'}>
              {writing ? 'Writing…' : 'Rewrite'}
            </button>
          </span>
          <textarea
            rows={2}
            maxLength={260}
            value={shown}
            placeholder={writing ? 'Claude is writing a short description…' : 'One or two sentences: what it is and who it’s for.'}
            onChange={(e) => setBlurb(e.target.value)}
            onBlur={() => void saveBlurb(u.id, shown)}
          />
        </label>

        <h3>Description</h3>
        {!accessories && <p className="muted small">No accessories on this unit. Add them in the unit window (Accessories on this unit) to list them with the total as equipped.</p>}
        <pre className="mp-desc">{description}</pre>

        {error && <p className="error">{error}</p>}
        {sent && (
          <p className="success">
            {ebay
              ? 'eBay is open in a new tab. Torque types the title on “What are you selling?”: pick the eBay Motors category and condition, then it fills the listing form (photos, title, VIN, year, make, model, mileage, price, ZIP, description) and sets the format to Classified ad. The panel in the corner has a Copy button for anything eBay wouldn’t take. Check the fees, then click List yourself.'
              : offerup
              ? 'OfferUp is open in a new tab. Torque opens its Post an item form and fills it: your watermarked photos, the title, description, price, New or Used, the Vehicles category and Florence as the location. The panel in the corner shows anything it could not do. Check it, then click Post item yourself.'
              : 'Facebook is open in a new tab and filling in the draft with your watermarked photos. Check everything there, then click Next and Publish yourself.'}
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

function InstallSteps({ update, needs = MIN_EXTENSION }: { update?: string; needs?: string }) {
  return (
    <div className={`notice stack tight${update ? ' mp-update' : ''}`}>
      <strong>
        {update
          ? `Update your Torque Marketplace Lister: you have v${update}, this needs v${needs} or newer`
          : 'One-time setup: install the Torque Marketplace Lister in Chrome'}
      </strong>
      {update && (
        <span className="small">
          The old one leaves out your accessories and total price, and makes you pick the Year and Florence, AL yourself.
        </span>
      )}
      <ol className="small help-steps">
        <li>
          <a href="/torque-marketplace-lister.zip" download>
            Download the extension
          </a>{' '}
          and unzip it {update ? 'over your old Torque Marketplace Lister folder (replace the files).' : "to a folder you'll keep (e.g. Documents)."}
        </li>
        {update ? (
          <li>In Chrome, open chrome://extensions and click the circle-arrow (reload) on Torque Marketplace Lister.</li>
        ) : (
          <>
            <li>In Chrome, open chrome://extensions and turn on Developer mode (top right).</li>
            <li>Click Load unpacked and pick the unzipped folder.</li>
          </>
        )}
        <li>Reload this page. Stay logged in to Facebook (and OfferUp and eBay, if you list there) in Chrome.</li>
      </ol>
    </div>
  );
}
