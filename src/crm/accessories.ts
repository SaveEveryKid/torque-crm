import { kv } from '../core/storage/kv';
import { readSheet } from './csvImport';
import { useStoredKey } from './store';

/**
 * ACCESSORIES ON A UNIT. Your accessory labor list (uploaded once, from the
 * CSV) gives each part its description and install labor. On a unit you pick
 * the part numbers and type each part's price; Torque adds the labor and
 * puts the accessories (price with labor, never the labor itself) and the
 * total in the Marketplace description, so every ad shows the unit as built.
 * PassTime GPS is always listed at no charge (the store gives it).
 */
export interface CatalogItem {
  /** Stable id for this choice (part number + description + labor). */
  key: string;
  /** Part number ('' when the list has none, e.g. aftermarket kits). */
  part: string;
  /** For the ad (install notes like "- NEEDS BUS BAR" removed). */
  description: string;
  /** Install labor in dollars (added to your price; never shown in the ad). */
  labor: number;
  /** The description as written in the list. */
  listed: string;
  /** Which units this labor charge is for (the sheet's vehicle sections, e.g. "05"). */
  sections?: string[];
  /** Always $0, shown as "no charge". */
  free?: boolean;
}

export interface UnitAccessory {
  key: string;
  part: string;
  description: string;
  /** What you typed for the part (dollars). */
  price: number;
  labor: number;
  free?: boolean;
}

export const GPS: CatalogItem = { key: 'PASSTIMEGPS', part: 'PASSTIMEGPS', description: 'PASSTIME GPS', listed: 'PASSTIME GPS', labor: 0, free: true };
export const MAX_ACCESSORIES = 15;

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** The ad's wording: install notes off ("- NEEDS BUS BAR", "- ONLY BASE MODEL"). */
export function adDescription(listed: string): string {
  return listed
    .replace(/\s+-\s+(NEEDS|ONLY|REQUIRES)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read your accessory labor list (CSV): one choice per part/description/labor. */
export function readCatalog(text: string): { items: CatalogItem[]; skipped: string[] } | { error: string } {
  const sheet = readSheet(text);
  if ('error' in sheet) return sheet;
  const col = (name: RegExp) => sheet.headers.findIndex((h) => name.test(h.toLowerCase()));
  const iPart = col(/part/);
  const iDesc = col(/desc/);
  const iCost = col(/labor_cost|labor cost|cost/);
  const iHours = col(/hours/);
  const iRate = col(/rate/);
  const iSections = col(/section/);
  if (iDesc < 0 || (iCost < 0 && iHours < 0)) return { error: 'This file needs a description column and a labor cost (or labor hours) column.' };
  const seen = new Map<string, CatalogItem>();
  const skipped: string[] = [];
  for (const { cells } of sheet.rows) {
    const listed = (cells[iDesc] ?? '').trim();
    if (!listed) continue;
    // "STAGE 1 - UNSPECIFIED ACCESSORY": doesn't say what it is, so it can't go in an ad.
    if (/unspecified/i.test(listed)) {
      if (!skipped.includes(listed)) skipped.push(listed);
      continue;
    }
    const part = iPart >= 0 ? (cells[iPart] ?? '').trim() : '';
    let labor = iCost >= 0 ? num(cells[iCost]) : NaN;
    if (!(labor >= 0) || (labor === 0 && num(cells[iHours]) > 0)) labor = num(cells[iHours]) * (num(cells[iRate]) || 0);
    if (!(labor >= 0)) labor = 0;
    labor = Math.round(labor * 100) / 100;
    const key = `${part}|${listed}|${labor}`;
    const sections = iSections >= 0 ? (cells[iSections] ?? '').split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean) : [];
    const had = seen.get(key);
    if (had) had.sections = [...new Set([...(had.sections ?? []), ...sections])].sort();
    else seen.set(key, { key, part, description: adDescription(listed), listed, labor, sections: [...new Set(sections)].sort() });
  }
  const items = [...seen.values()].sort((a, b) => a.description.localeCompare(b.description) || a.part.localeCompare(b.part) || a.labor - b.labor);
  if (!items.length) return { error: 'No accessories found in this file.' };
  return { items, skipped };
}

/** The dropdown choices: PassTime GPS, then your list. Parts that have more than one labor charge show each. */
export function choices(catalog: CatalogItem[]): CatalogItem[] {
  return [GPS, ...catalog.filter((c) => c.part.toUpperCase() !== GPS.part)];
}

/**
 * Which unit each section of the labor sheet is for. Filled in, the dropdown
 * names the unit instead of "section 05".
 */
export const SECTION_UNITS: Record<string, string> = {};

export const sectionName = (code: string) => SECTION_UNITS[code] ?? `section ${code}`;

export function choiceLabel(c: CatalogItem, all: CatalogItem[]): string {
  if (c.free) return 'PASSTIMEGPS — PassTime GPS (no charge)';
  // The same part with a different labor charge per unit: say which unit this one is for.
  const twins = all.filter((o) => o.part === c.part && o.listed === c.listed);
  const units = (c.sections ?? []).map(sectionName).join(', ');
  return `${c.part || '(no part #)'} — ${c.listed}${twins.length > 1 ? ` (${units ? `for ${units} · ` : ''}labor $${c.labor.toFixed(2)})` : ''}`;
}

export const installed = (a: Pick<UnitAccessory, 'price' | 'labor' | 'free'>) => (a.free ? 0 : Math.round((a.price + a.labor) * 100) / 100);

export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The ad's accessory lines and total ("" when the unit has none). Labor is in each price, never mentioned. */
export function accessoryBlock(list: UnitAccessory[], unitPrice: number | null): string {
  const items = list.filter((a) => a.description && (a.free || a.price >= 0));
  if (!items.length) return '';
  const lines = items.map((a) => `• ${a.description} – ${a.free ? 'included at no charge' : money(installed(a))}`);
  const extra = items.reduce((s, a) => s + installed(a), 0);
  const out = ['Equipped with:', ...lines];
  if (unitPrice && unitPrice > 0) {
    out.push(extra > 0 ? `Total price as equipped: ${money(unitPrice + extra)} (unit ${money(unitPrice)} + accessories ${money(extra)})` : `Total price as equipped: ${money(unitPrice)}`);
  } else if (extra > 0) {
    out.push(`Accessories total: ${money(extra)}`);
  }
  return out.join('\n');
}

// ---- stored in your Torque database (not in the code: your labor costs are internal)

export const useCatalog = () => useStoredKey<CatalogItem[]>('accessoryCatalog', []);
export async function saveCatalog(items: CatalogItem[]): Promise<void> {
  await kv.set({ accessoryCatalog: items });
}

export type UnitAccessories = Record<string, UnitAccessory[]>;
export const useUnitAccessories = () => useStoredKey<UnitAccessories>('unitAccessories', {});
export async function saveUnitAccessories(unitId: string, list: UnitAccessory[]): Promise<void> {
  const all = ((await kv.get('unitAccessories')).unitAccessories as UnitAccessories | undefined) ?? {};
  const next = { ...all };
  if (list.length) next[unitId] = list;
  else delete next[unitId];
  await kv.set({ unitAccessories: next });
}
