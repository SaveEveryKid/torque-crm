import { useEffect, useMemo, useState } from 'react';
import { kv } from '../core/storage/kv';
import type { Unit } from './inventory';
import { paymentText } from './paymentMark';
import { useStoredKey } from './store';

/**
 * LIST ON FACEBOOK MARKETPLACE, through the Torque Marketplace Lister Chrome
 * extension (a website isn't allowed to fill in facebook.com, an extension
 * is). The CRM page and the extension talk with window messages; the
 * extension opens Facebook's vehicle form, fills it, and uploads the photos
 * with the watermarks. It never publishes: you review and click Publish.
 */
export interface ListerInfo {
  version: string;
  description: string;
  location: string;
  vehicleType: string;
  maxPhotos: number;
  watermarks: { dataUrl: string; spec: { width: number; x: number; y: number; anchor: string; opacity: number } }[];
  missingWatermarks: boolean;
  /** Where the payment watermark goes (newer extensions). */
  paymentSpec?: { width: number; x: number; y: number; anchor: string; opacity: number };
  /** Units the extension has sent to Facebook (id → when, title). */
  listed?: Listed;
}

export interface ListingUnit {
  id: string;
  title: string;
  year: string | null;
  make: string | null;
  model: string | null;
  price: number | null;
  /** The monthly payment you typed (from your grid). */
  payment: number | null;
  /** The payment watermark, drawn for this listing (PNG data URL). */
  paymentMark?: string | null;
  /** Dealer photo URLs, and "upload:N" for your own photos (uploads[N]). */
  photos: string[];
  /** Your own photos (JPEG data URLs, store logo already on). */
  uploads?: string[];
  /** The accessories and total as equipped, for the description. */
  accessories?: string;
  /** The whole description, exactly as shown in Torque (the extension types this). */
  description?: string;
}

type Reply = { source: 'torque-lister'; id: string | null; ok: boolean; error?: string; type?: string } & Partial<ListerInfo>;

let seq = 0;
function ask(type: 'PING' | 'LIST_ON_MARKETPLACE', unit?: ListingUnit, timeout = 4000): Promise<Reply> {
  const id = `m${Date.now()}-${++seq}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => (removeEventListener('message', on), reject(new Error('NOT_INSTALLED'))), timeout);
    const on = (e: MessageEvent) => {
      const r = e.data as Reply;
      if (e.source !== window || r?.source !== 'torque-lister' || r.id !== id) return;
      clearTimeout(t);
      removeEventListener('message', on);
      resolve(r);
    };
    addEventListener('message', on);
    window.postMessage({ source: 'torque-crm', type, id, unit }, location.origin);
  });
}

/** Is the extension installed (and what will a listing look like)? null while checking; false when it isn't. */
export function useLister(): ListerInfo | false | null {
  const [info, setInfo] = useState<ListerInfo | false | null>(null);
  useEffect(() => {
    let live = true;
    ask('PING', undefined, 2500)
      .then((r) => {
        if (r.ok && r.listed) void syncListed(r.listed);
        if (live) setInfo(r.ok ? (r as unknown as ListerInfo) : false);
      })
      .catch(() => live && setInfo(false));
    return () => void (live = false);
  }, []);
  return info;
}

/** The listing description for a unit (same as the extension: payment filled in, or that line left out). */
export function describe(template: string, payment: number | null, accessories = ''): string {
  // "NO DEALER FEES!" (even if the extension's template still says NO HIDDEN FEES).
  let lines = template.split('\n').map((l) => (/no hidden fees/i.test(l) ? '✅️ NO DEALER FEES! ✅️' : l));
  if (!payment || payment <= 0) lines = lines.filter((l) => !l.includes('{payment}'));
  const block = accessories.trim();
  let at = lines.indexOf('{accessories}');
  // A template without the accessories spot (older extension): they go where
  // "Optional accessories…" was (or at the end), never left out.
  const optional = lines.findIndex((l) => /^optional accessories/i.test(l.trim()));
  if (block && at < 0) {
    at = optional >= 0 ? optional : lines.length;
    lines.splice(at, 0, '{accessories}', '');
  }
  // "Optional accessories not included in pricing…" is no longer used (even if an older extension's template still has it).
  const drop = lines.findIndex((l) => /^optional accessories/i.test(l.trim()));
  if (drop >= 0) lines.splice(drop, lines[drop + 1] === '' ? 2 : 1);
  at = lines.indexOf('{accessories}');
  if (!block && at >= 0) lines.splice(at, lines[at + 1] === '' ? 2 : 1);
  return lines
    .join('\n')
    .replace('{payment}', payment && payment > 0 ? `${paymentText(payment)}/mo` : '')
    .replace('{accessories}', () => block);
}

/** The payment you last typed for each unit (so listing again starts with it). */
export type Payments = Record<string, number>;
export const usePayments = () => useStoredKey<Payments>('marketplacePayments', {});
export async function rememberPayment(id: string, payment: number): Promise<void> {
  const m = ((await kv.get('marketplacePayments')).marketplacePayments as Payments | undefined) ?? {};
  if (m[id] !== payment) await kv.set({ marketplacePayments: { ...m, [id]: payment } });
}

/** The oldest Torque Marketplace Lister that does everything this CRM asks (description as written, Year and Florence picked for you). */
export const MIN_EXTENSION = '0.9.0';

/** Is version a older than b ("0.8.0" < "0.9.0" < "0.10.0")? */
export function olderThan(a: string | undefined, b: string): boolean {
  const pa = String(a ?? '0').split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

export function toListing(u: Unit, photos: string[], payment: number | null, paymentMark: string | null, accessories = '', description = ''): ListingUnit {
  const uploads: string[] = [];
  const refs = photos.map((p) => (p.startsWith('data:') ? `upload:${uploads.push(p) - 1}` : p));
  return { id: u.id, title: u.title, year: u.year, make: u.make, model: u.model, price: u.price, payment, paymentMark, photos: refs, uploads, accessories, ...(description ? { description } : {}) };
}

export async function listOnMarketplace(u: ListingUnit): Promise<void> {
  const r = await ask('LIST_ON_MARKETPLACE', u, 20000).catch((e: Error) => {
    throw new Error(e.message === 'NOT_INSTALLED' ? 'The Torque Marketplace Lister extension isn’t answering. Is it installed and turned on?' : e.message);
  });
  if (!r.ok) throw new Error(r.error || 'The extension couldn’t start the listing.');
  await markListed(u.id, u.title);
}

/** Units sent to Marketplace: when, and the title then. `off` = you marked it not listed. */
export type Listed = Record<string, { at: string; title: string; off?: boolean }>;

const readListed = async () => ((await kv.get('marketplace')).marketplace as Listed | undefined) ?? {};

/** Mark a unit listed (or, with off, not listed) on Marketplace. */
export async function markListed(id: string, title: string, off = false): Promise<void> {
  const m = await readListed();
  await kv.set({ marketplace: { ...m, [id]: { at: new Date().toISOString(), title, ...(off ? { off: true } : {}) } } });
}

/**
 * The extension's own record of what it sent to Facebook, merged in (so a unit
 * is marked Listed even if the CRM missed the extension's reply). Only newer
 * listings count, so a unit you marked "not listed" stays that way until you
 * list it again.
 */
export function mergeListed(ours: Listed, theirs: Listed): Listed | null {
  let out: Listed | null = null;
  for (const [id, v] of Object.entries(theirs)) {
    if (!v || typeof v.at !== 'string') continue;
    const have = ours[id];
    if (have && have.at >= v.at) continue;
    out = out ?? { ...ours };
    out[id] = { at: v.at, title: String(v.title ?? '') };
  }
  return out;
}

export async function syncListed(theirs: Listed): Promise<void> {
  const merged = mergeListed(await readListed(), theirs);
  if (merged) await kv.set({ marketplace: merged });
}

/** Units on Marketplace (marked listed, not unmarked). */
export function useListed(): Listed {
  const all = useStoredKey<Listed>('marketplace', {});
  return useMemo(() => Object.fromEntries(Object.entries(all).filter(([, v]) => !v.off)), [all]);
}
