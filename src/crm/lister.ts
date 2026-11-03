import { useEffect, useState } from 'react';
import { kv } from '../core/storage/kv';
import type { Unit } from './inventory';
import { useStoredKey } from './store';

/**
 * LIST ON FACEBOOK MARKETPLACE, through the Torque Marketplace Lister Chrome
 * extension (a website isn't allowed to fill in facebook.com, an extension
 * is). The CRM page and the extension talk with window messages; the
 * extension opens Facebook's vehicle form, fills it, and uploads the photos
 * with the two watermarks. It never publishes: you review and click Publish.
 */
export interface ListerInfo {
  version: string;
  description: string;
  location: string;
  vehicleType: string;
  maxPhotos: number;
  watermarks: { dataUrl: string; spec: { width: number; x: number; y: number; anchor: string; opacity: number } }[];
  missingWatermarks: boolean;
}

export interface ListingUnit {
  id: string;
  title: string;
  year: string | null;
  make: string | null;
  model: string | null;
  price: number | null;
  photos: string[];
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
      .then((r) => live && setInfo(r.ok ? (r as unknown as ListerInfo) : false))
      .catch(() => live && setInfo(false));
    return () => void (live = false);
  }, []);
  return info;
}

export function toListing(u: Unit, photos: string[]): ListingUnit {
  return { id: u.id, title: u.title, year: u.year, make: u.make, model: u.model, price: u.price, photos };
}

export async function listOnMarketplace(u: ListingUnit): Promise<void> {
  const r = await ask('LIST_ON_MARKETPLACE', u, 20000).catch((e: Error) => {
    throw new Error(e.message === 'NOT_INSTALLED' ? 'The Torque Marketplace Lister extension isn’t answering. Is it installed and turned on?' : e.message);
  });
  if (!r.ok) throw new Error(r.error || 'The extension couldn’t start the listing.');
  const m = ((await kv.get('marketplace')).marketplace as Listed | undefined) ?? {};
  await kv.set({ marketplace: { ...m, [u.id]: { at: new Date().toISOString(), title: u.title } } });
}

export type Listed = Record<string, { at: string; title: string }>;
/** Units you've sent to Marketplace (when, from this CRM). */
export const useListed = () => useStoredKey<Listed>('marketplace', {});
