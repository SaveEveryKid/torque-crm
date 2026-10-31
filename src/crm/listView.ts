import { useEffect, useState } from 'react';
import { fullName, lastContact } from './store';
import { STAGES, type Customer, type Stage } from './types';

/**
 * HOW THE CUSTOMER LIST IS SHOWN: filters and sort, remembered while this tab
 * is open, so Back returns to the same spot and a customer's page can step to
 * the previous / next customer in that same order.
 */
export type SortKey = 'name' | 'first' | 'name-desc' | 'business' | 'location' | 'added' | 'updated' | 'contact' | 'stage';

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'Last name A–Z' },
  { id: 'first', label: 'First name A–Z' },
  { id: 'name-desc', label: 'Last name Z–A' },
  { id: 'business', label: 'Business A–Z' },
  { id: 'location', label: 'State, then city' },
  { id: 'added', label: 'Newest added' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'contact', label: 'Longest since contact' },
  { id: 'stage', label: 'Stage' },
];

export interface View {
  stage: Stage | 'all' | 'open';
  sort: SortKey;
  q: string;
  kind: 'all' | 'people' | 'business';
  state: string;
  source: string;
  reach: 'all' | 'email' | 'phone' | 'never';
  page: number;
}

export const DEFAULT_VIEW: View = { stage: 'open', sort: 'name', q: '', kind: 'all', state: '', source: '', reach: 'all', page: 0 };
export const PAGE_SIZE = 50;

const STATE = /\b(AL|MS|TN|GA|FL|KY|AR|LA|TX|MO|NC|SC|VA|OH|IN|IL)\b(?:\s+\d{5})?\s*$/;
/** "Columbus, MS" → { city: 'Columbus', state: 'MS' }. */
export function placeOf(c: Pick<Customer, 'address'>): { city: string; state: string } {
  const a = c.address.trim();
  const state = STATE.exec(a)?.[1] ?? '';
  const parts = a.replace(STATE, '').split(',').map((x) => x.trim()).filter(Boolean);
  return { city: parts.length ? parts[parts.length - 1] : '', state };
}

const hasPerson = (c: Customer) => !!`${c.firstName}${c.lastName}`.trim();
/** Sort by last name, then first; a business-only contact by the business name. */
const clean = (s: string) => s.toLowerCase().replace(/^[^a-z0-9]+/, '').trim();
const nameKey = (c: Customer) => clean(hasPerson(c) ? `${c.lastName || c.firstName} ${c.lastName ? c.firstName : ''}` : c.company ?? '');
const firstKey = (c: Customer) => clean(hasPerson(c) ? `${c.firstName || c.lastName} ${c.lastName}` : c.company ?? '');
export const sortLetter = (c: Customer, sort: SortKey) => {
  const k = sort === 'business' ? clean(c.company || fullName(c)) : sort === 'first' ? firstKey(c) : sort.startsWith('name') ? nameKey(c) : '';
  const ch = k.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
};

const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i])) as Record<Stage, number>;

export function matchesStage(c: Customer, stage: View['stage']) {
  return stage === 'all' ? true : stage === 'open' ? !['sold', 'lost'].includes(c.stage) : c.stage === stage;
}

/** Everything but the stage filter (the stage tabs show counts across it). */
export function baseFilter(list: Customer[], v: View): Customer[] {
  const s = v.q.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  return list.filter(
    (c) =>
      (v.kind === 'all' || (v.kind === 'people') === hasPerson(c)) &&
      (!v.state || placeOf(c).state === v.state) &&
      (!v.source || c.source === v.source) &&
      (v.reach === 'all' || (v.reach === 'email' ? !!c.email : v.reach === 'phone' ? !!c.phone : !lastContact(c))) &&
      (!s ||
        [fullName(c), c.company ?? '', c.title ?? '', c.address, c.email, c.interest, c.notes, c.vehicle?.title ?? ''].some((x) => x.toLowerCase().includes(s)) ||
        (digits.length >= 3 && [c.phone, c.altPhone].some((p) => p.replace(/\D/g, '').includes(digits)))),
  );
}

export function sortCustomers(list: Customer[], sort: SortKey): Customer[] {
  const by = (f: (c: Customer) => string) => (a: Customer, b: Customer) => f(a).localeCompare(f(b), undefined, { sensitivity: 'base', numeric: true }) || nameKey(a).localeCompare(nameKey(b));
  const cmp: Record<SortKey, (a: Customer, b: Customer) => number> = {
    name: by(nameKey),
    first: by(firstKey),
    'name-desc': (a, b) => nameKey(b).localeCompare(nameKey(a)),
    business: by((c) => clean(c.company || fullName(c))),
    location: by((c) => `${placeOf(c).state || '~'} ${placeOf(c).city}`.toLowerCase()),
    added: (a, b) => b.createdAt.localeCompare(a.createdAt) || nameKey(a).localeCompare(nameKey(b)),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    contact: (a, b) => (lastContact(a) ?? '').localeCompare(lastContact(b) ?? '') || nameKey(a).localeCompare(nameKey(b)),
    stage: (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || nameKey(a).localeCompare(nameKey(b)),
  };
  return [...list].sort(cmp[sort]);
}

export function applyView(list: Customer[], v: View): Customer[] {
  return sortCustomers(baseFilter(list, v).filter((c) => matchesStage(c, v.stage)), v.sort);
}

const read = <T,>(k: string, fallback: T): T => {
  try {
    const raw = sessionStorage.getItem(k);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    // private window: the view just isn't remembered
  }
};

/** The list's filters and sort, remembered for this tab under `key`. */
export function useView(key: string): [View, (patch: Partial<View>) => void] {
  const [v, setV] = useState<View>(() => read(`tcrm.view.${key}`, DEFAULT_VIEW));
  useEffect(() => write(`tcrm.view.${key}`, v), [key, v]);
  // Changing a filter goes back to the first page; changing the page keeps the rest.
  return [v, (patch) => setV((x) => ({ ...x, ...('page' in patch ? {} : { page: 0 }), ...patch }))];
}

/** The order last shown on the Customers page (for previous / next on a customer). */
export const rememberOrder = (ids: string[]) => write('tcrm.order', ids);
export function neighbors(id: string): { prev: string | null; next: string | null; index: number; total: number } {
  let ids: string[] = [];
  try {
    ids = JSON.parse(sessionStorage.getItem('tcrm.order') ?? '[]') as string[];
  } catch {
    ids = [];
  }
  const i = ids.indexOf(id);
  return { prev: i > 0 ? ids[i - 1] : null, next: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null, index: i, total: ids.length };
}
