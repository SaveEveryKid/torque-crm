import { useState } from 'react';
import { aiReady } from '../crm/ai';
import { money } from '../crm/inventory';
import { USE_TAGS, findMatches, type Needs } from '../crm/matcher';
import { logActivity, updateCustomer, useSettings } from '../crm/store';
import type { Customer, VehicleRef } from '../crm/types';
import { copy, Icon } from './kit';

/**
 * FIND THE RIGHT UNIT: the desk interview (what they'll use it for), then
 * Claude's 3 best matches from what's in stock, with links.
 */
export function UnitFinder({ customer: c, onText }: { customer: Customer; onText: (body: string) => void }) {
  const settings = useSettings();
  const [needs, setNeeds] = useState<Needs>(c.needs ?? { use: '', tags: [], riders: '', budget: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const match = c.match;

  const set = (patch: Partial<Needs>) => setNeeds((n) => ({ ...n, ...patch }));
  const toggle = (t: string) => set({ tags: needs.tags.includes(t) ? needs.tags.filter((x) => x !== t) : [...needs.tags, t] });

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await findMatches(c, settings, needs);
      await updateCustomer(c.id, { needs, match: r });
      await logActivity(c.id, { channel: 'NOTE', direction: 'INTERNAL', outcome: 'Vehicle', text: `Suggested units: ${r.picks.map((p) => p.v.title).join('; ')}` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const attach = async (v: VehicleRef) => {
    await updateCustomer(c.id, { vehicle: v });
    await logActivity(c.id, { channel: 'NOTE', direction: 'INTERNAL', outcome: 'Vehicle', text: `Showing ${v.title}${v.stock ? ` (stock ${v.stock})` : ''}` });
  };

  const links = (match?.picks ?? []).map((p) => `${p.v.title}: ${p.v.url ?? ''}`).join('\n');
  const textBody = match?.picks.length
    ? `Hi ${c.firstName || 'there'}, here are the ${match.picks.length === 1 ? 'one' : match.picks.length === 2 ? 'two' : 'three'} I'd look at for what you told me:\n${match.picks.map((p) => `${p.v.title}${p.v.url ? ` ${p.v.url}` : ''}`).join('\n')}\nWhich one do you want to see first?`
    : '';

  return (
    <section className="card unit-finder">
      <div className="card-head">
        <h2 className="row">
          <Icon name="sparkle" /> Find the right unit
        </h2>
      </div>
      <div className="card-pad stack">
        <label className="field">
          What will they use it for?
          <textarea
            rows={3}
            value={needs.use}
            onChange={(e) => set({ use: e.target.value })}
            placeholder="e.g. Deer hunting on 40 acres, haul feed and a few hay bales, wife rides along, trails are tight"
          />
        </label>
        <div className="chips">
          {USE_TAGS.map((t) => (
            <button key={t} className={`chip${needs.tags.includes(t) ? ' on' : ''}`} onClick={() => toggle(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="row">
          <input className="grow" value={needs.riders} onChange={(e) => set({ riders: e.target.value })} placeholder="Riders (e.g. 2 adults, 2 kids)" aria-label="Riders" />
          <input style={{ width: 130 }} value={needs.budget} onChange={(e) => set({ budget: e.target.value })} placeholder="Budget (optional)" aria-label="Budget" />
        </div>
        <button className="btn primary" disabled={busy || !aiReady() || (!needs.use.trim() && !needs.tags.length)} onClick={() => void find()}>
          <Icon name="sparkle" size={15} /> {busy ? 'Looking through inventory…' : match ? 'Find 3 units again' : 'Find 3 units'}
        </button>
        {!aiReady() && <p className="muted small">Needs the dialer set up (Claude goes through it).</p>}
        {error && <p className="error">{error}</p>}

        {match && match.picks.length > 0 && (
          <div className="stack">
            {match.summary && <p className="why">{match.summary}</p>}
            {match.picks.map((p, i) => (
              <div key={p.v.id} className="match">
                {p.v.image ? <img src={p.v.image} alt="" referrerPolicy="no-referrer" /> : <div className="noimg">{i + 1}</div>}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">
                    {i + 1}. {p.v.title}
                  </div>
                  <div className="muted small">
                    {money(p.v.price)}
                    {p.v.stock ? ` · #${p.v.stock}` : ''}
                    {p.inStock > 1 ? ` · ${p.inStock} in stock` : ''}
                  </div>
                  {p.reason && <div className="small soft">{p.reason}</div>}
                  <div className="row" style={{ marginTop: 4 }}>
                    {p.v.url && (
                      <a className="small" href={p.v.url} target="_blank" rel="noreferrer">
                        Open listing <Icon name="external" size={12} />
                      </a>
                    )}
                    <button className="link small" onClick={() => void attach(p.v)}>
                      {c.vehicle?.id === p.v.id ? '✓ Their vehicle' : 'Attach'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="row">
              <button className="btn sm" onClick={() => void copy(links).then(() => setCopied(true))}>
                <Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy links'}
              </button>
              <button className="btn sm" disabled={c.doNotText || c.doNotContact} onClick={() => onText(textBody)}>
                <Icon name="text" size={14} /> Text these {match.picks.length}
              </button>
            </div>
            <p className="muted small">Suggested {new Date(match.at).toLocaleString()} from what was in stock then. Check the unit is still on the lot before promising it.</p>
          </div>
        )}
      </div>
    </section>
  );
}
