import { kv } from '../core/storage/kv';
import type { Unit } from './inventory';
import { useStoredKey } from './store';

/**
 * CUSTOM UNITS: a unit that isn't on the website yet (on order, coming in),
 * typed in by you so it can be listed on Facebook, OfferUp and eBay like any
 * other. Only the details are saved here; the photos are added in the List
 * window (Add your own photos), where the store logo goes on them.
 */
export interface CustomUnit {
  id: string;
  year: string;
  make: string;
  model: string;
  condition: 'New' | 'Used';
  /** e.g. Regular Cab, ATV: Full-Size Utility. */
  type: string;
  color: string;
  price: number | null;
  msrp: number | null;
  stock: string;
  vin: string;
  /** Odometer miles (used units). */
  miles: number | null;
  /** A few words about it (Claude uses them for the short description). */
  about: string;
  createdAt: string;
}

export const CUSTOM_PREFIX = 'custom-';
export const isCustom = (u: Pick<Unit, 'id'>) => u.id.startsWith(CUSTOM_PREFIX);

export const newCustomId = () => `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const customTitle = (c: Pick<CustomUnit, 'year' | 'make' | 'model'>) => [c.year, c.make, c.model].map((x) => x.trim()).filter(Boolean).join(' ') || 'Custom unit';

/** A custom unit as an inventory unit (no photos: they're added when you list it). */
export function toUnit(c: CustomUnit, store = ''): Unit {
  return {
    id: c.id,
    title: customTitle(c),
    year: c.year.trim() || null,
    make: c.make.trim() || null,
    model: c.model.trim() || null,
    condition: c.condition,
    type: c.type.trim() || null,
    price: c.price,
    msrp: c.msrp && c.price && c.msrp > c.price ? c.msrp : null,
    stock: c.stock.trim() || null,
    vin: c.vin.trim() || null,
    color: c.color.trim() || null,
    usage: c.miles != null && c.miles > 0 ? `${c.miles.toLocaleString('en-US')} mi` : null,
    location: store || null,
    image: null,
    photos: [],
    url: null,
    raw: { objectID: c.id, LongDescription: c.about, Specs: '' },
  };
}

export type CustomUnits = Record<string, CustomUnit>;
export const useCustomUnits = () => useStoredKey<CustomUnits>('customUnits', {});

const read = async () => ((await kv.get('customUnits')).customUnits as CustomUnits | undefined) ?? {};

export async function saveCustomUnit(c: CustomUnit): Promise<void> {
  await kv.set({ customUnits: { ...(await read()), [c.id]: c } });
}

export async function deleteCustomUnit(id: string): Promise<void> {
  const all = { ...(await read()) };
  delete all[id];
  await kv.set({ customUnits: all });
}

/** Does a custom unit match the inventory search box? (every word somewhere in it) */
export function matchesSearch(u: Unit, query: string): boolean {
  const hay = [u.title, u.type, u.color, u.stock, u.vin, u.condition].filter(Boolean).join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
