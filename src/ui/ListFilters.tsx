import { useMemo } from 'react';
import { placeOf, SORTS, type SortKey, type View } from '../crm/listView';
import type { Customer } from '../crm/types';
import { Icon } from './kit';

/** Search, sort and filters for a customer list (Customers page, AI Follow-up). */
export function ListFilters({ list, view: v, set, compact }: { list: Customer[]; view: View; set: (p: Partial<View>) => void; compact?: boolean }) {
  const states = useMemo(() => [...new Set(list.map((c) => placeOf(c).state).filter(Boolean))].sort(), [list]);
  const sources = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of list) if (c.source) n.set(c.source, (n.get(c.source) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const active = v.kind !== 'all' || v.state || v.source || v.reach !== 'all' || v.q;

  return (
    <div className={`list-filters${compact ? ' compact' : ''}`}>
      <div className="search-in">
        <Icon name="search" size={15} />
        <input value={v.q} onChange={(e) => set({ q: e.target.value })} placeholder="Find by name, business, city, phone…" aria-label="Find" />
      </div>
      <select value={v.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="Sort">
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select value={v.kind} onChange={(e) => set({ kind: e.target.value as View['kind'] })} aria-label="People or businesses">
        <option value="all">People + businesses</option>
        <option value="people">People only</option>
        <option value="business">Businesses only (no name)</option>
      </select>
      {states.length > 1 && (
        <select value={v.state} onChange={(e) => set({ state: e.target.value })} aria-label="State">
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <select value={v.reach} onChange={(e) => set({ reach: e.target.value as View['reach'] })} aria-label="Contact">
        <option value="all">Any contact info</option>
        <option value="email">Has email</option>
        <option value="phone">Has phone</option>
        <option value="never">Never contacted</option>
      </select>
      {sources.length > 1 && (
        <select value={v.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source">
          <option value="">All sources</option>
          {sources.map(([s, n]) => (
            <option key={s} value={s}>
              {s} ({n})
            </option>
          ))}
        </select>
      )}
      {active && (
        <button className="link small" onClick={() => set({ kind: 'all', state: '', source: '', reach: 'all', q: '' })}>
          Clear filters
        </button>
      )}
    </div>
  );
}
