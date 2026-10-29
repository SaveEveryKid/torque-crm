import { kv } from '../core/storage/kv';
import type { VehicleRef } from './types';

/**
 * INVENTORY from the dealer's website (read-only). The site's inventory page
 * runs on Algolia search; the page carries a public, search-only key (the
 * same one every visitor's browser uses, limited to this dealer's units and
 * renewed by the site). Torque reads that page through the local server
 * (/dealer → the dealer site, see vite.config.ts), then searches the same
 * Algolia index the site does.
 */
export interface SearchConfig {
  appId: string;
  apiKey: string;
  index: string;
  sorts: { indexName: string; label: string }[];
  /** Seconds since 1970 when the site's key stops working (0 = unknown). */
  validUntil: number;
  siteUrl: string;
  readAt: string;
}

const KEY = 'inventoryConfig';
const DEALER_ORIGIN = 'https://www.shoalsoutdoorsports.com';

/** Pull the search setup out of the dealer's inventory page. */
export function parseSearchConfig(html: string, now = new Date()): SearchConfig {
  const m = html.match(/<script[^>]*class="showroom-search--config"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Couldn't find the inventory search on the dealer's page (the site may have changed).");
  const c = JSON.parse(m[1]) as { appId?: string; apiKey?: string; defaultIndexName?: string; sortingIndexes?: { indexName: string; label: string }[]; url?: string };
  if (!c.appId || !c.apiKey) throw new Error('The dealer page has no inventory search key.');
  let validUntil = 0;
  try {
    validUntil = Number(/validUntil=(\d+)/.exec(atob(c.apiKey))?.[1] ?? 0);
  } catch {
    /* not base64: no expiry known */
  }
  return {
    appId: c.appId,
    apiKey: c.apiKey,
    index: c.defaultIndexName ?? c.sortingIndexes?.[0]?.indexName ?? 'prod_WebSellable',
    sorts: (c.sortingIndexes ?? []).map((s) => ({ indexName: s.indexName, label: s.label })),
    validUntil,
    siteUrl: c.url ?? DEALER_ORIGIN,
    readAt: now.toISOString(),
  };
}

async function readDealerPage(path: string): Promise<SearchConfig> {
  let res: Response;
  try {
    res = await fetch(`/dealer${path.startsWith('/') ? path : `/${path}`}`, { headers: { Accept: 'text/html' } });
  } catch {
    throw new Error("Couldn't reach the dealer's website. Is Torque CRM running (Start Torque CRM)?");
  }
  if (!res.ok) throw new Error(`The dealer's website answered ${res.status}. Try again in a minute.`);
  const cfg = parseSearchConfig(await res.text());
  await kv.set({ [KEY]: cfg });
  return cfg;
}

/** The saved setup, re-read from the dealer site when it is about to expire (or when forced). */
export async function searchConfig(path: string, force = false): Promise<SearchConfig> {
  const saved = (await kv.get(KEY))[KEY] as SearchConfig | undefined;
  const fresh = saved && (!saved.validUntil || saved.validUntil * 1000 - Date.now() > 10 * 60_000);
  if (!force && saved && fresh) return saved;
  return readDealerPage(path);
}

export type Hit = Record<string, unknown> & { objectID: string };

export interface SearchResult {
  hits: Hit[];
  nbHits: number;
  page: number;
  nbPages: number;
  facets: Record<string, Record<string, number>>;
}

export interface SearchParams {
  query: string;
  page: number;
  index: string;
  filters: Record<string, string>;
}

async function algolia(cfg: SearchConfig, p: SearchParams): Promise<Response> {
  const facetFilters = Object.entries(p.filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const params = new URLSearchParams({ query: p.query, page: String(p.page), hitsPerPage: '24', facets: JSON.stringify(['*']), maxValuesPerFacet: '50' });
  if (facetFilters.length) params.set('facetFilters', JSON.stringify(facetFilters));
  return fetch(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(p.index || cfg.index)}/query`, {
    method: 'POST',
    headers: { 'X-Algolia-Application-Id': cfg.appId, 'X-Algolia-API-Key': cfg.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ params: params.toString() }),
  });
}

/** Search the dealer's in-stock inventory (re-reads the site's key once if it was refused). */
export async function searchInventory(path: string, p: SearchParams): Promise<SearchResult> {
  let cfg = await searchConfig(path);
  let res = await algolia(cfg, p);
  if (res.status === 403 || res.status === 400) {
    cfg = await searchConfig(path, true);
    res = await algolia(cfg, p);
  }
  if (!res.ok) throw new Error(`Inventory search failed (${res.status}).`);
  const body = (await res.json()) as Partial<SearchResult>;
  return { hits: body.hits ?? [], nbHits: body.nbHits ?? 0, page: body.page ?? 0, nbPages: body.nbPages ?? 0, facets: body.facets ?? {} };
}

/* ---------- reading a unit (field names vary by site: look for each one several ways) ---------- */

function pick(h: Hit, names: string[]): unknown {
  const lower = new Map(Object.keys(h).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const k = lower.get(n.toLowerCase());
    const v = k ? h[k] : undefined;
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v;
  }
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstImage(v: unknown): string | null {
  if (typeof v === 'string') return v.split(/[,|]/)[0].trim() || null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = typeof x === 'string' ? x : x && typeof x === 'object' ? str(pick(x as Hit, ['Url', 'ImageUrl', 'Src', 'Path', 'Large', 'Medium'])) : null;
      if (s) return s;
    }
  }
  return null;
}

const PHOTO = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)|\/media\/|\/images?\/|imgix|cloudinary/i;
const PHOTO_KEY = /image|photo|media|picture|thumb|pic/i;

/**
 * Any photo link anywhere in the listing (field names differ from site to
 * site): fields named like images first, then any link that looks like a photo.
 */
export function findPhoto(h: unknown): string | null {
  const named: string[] = [];
  const other: string[] = [];
  const walk = (v: unknown, keyHint: boolean, depth: number) => {
    if (depth > 5 || named.length) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!/^(https?:)?\/\/|^\/[^/]/.test(t) || t.length > 1000) return;
      if (keyHint && (PHOTO.test(t) || /^https?:\/\//.test(t))) named.push(t);
      else if (PHOTO.test(t) && !/\/Inventory\//i.test(t)) other.push(t);
    } else if (Array.isArray(v)) for (const x of v) walk(x, keyHint, depth + 1);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, keyHint || PHOTO_KEY.test(k), depth + 1);
  };
  walk(h, false, 0);
  return named[0] ?? other[0] ?? null;
}

function absolute(u: string | null): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `${DEALER_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`;
}

export interface Unit {
  id: string;
  title: string;
  year: string | null;
  make: string | null;
  model: string | null;
  condition: string | null;
  type: string | null;
  price: number | null;
  msrp: number | null;
  stock: string | null;
  vin: string | null;
  color: string | null;
  usage: string | null;
  location: string | null;
  image: string | null;
  url: string | null;
  raw: Hit;
}

export function readUnit(h: Hit): Unit {
  const year = str(pick(h, ['Year', 'ModelYear', 'UnitYear']));
  const make = str(pick(h, ['Manufacturer', 'Make', 'ManufacturerName', 'Brand', 'BrandName']));
  const model = str(pick(h, ['Model', 'ModelName', 'ProductName', 'Name']));
  const display = str(pick(h, ['Title', 'DisplayName', 'UnitName']));
  const title = display ? (year && !display.includes(year) ? `${year} ${display}` : display) : [year, make, model].filter(Boolean).join(' ');
  const sale = num(pick(h, ['SalePrice', 'InternetPrice', 'Price', 'DisplayPrice', 'SellingPrice', 'WebPrice']));
  const msrp = num(pick(h, ['MSRP', 'Msrp', 'RetailPrice', 'OriginalPrice']));
  const hours = str(pick(h, ['Hours', 'EngineHours']));
  const miles = str(pick(h, ['Miles', 'Mileage', 'Odometer']));
  return {
    id: h.objectID,
    title: title || 'Unit',
    year,
    make,
    model,
    condition: str(pick(h, ['Condition', 'Usage', 'NewUsed', 'IsNew'])),
    type: str(pick(h, ['ProductType', 'Category', 'Type', 'VehicleType', 'Industry'])),
    price: sale ?? msrp,
    msrp: msrp && sale && msrp > sale ? msrp : null,
    stock: str(pick(h, ['StockNumber', 'Stock', 'StockNo', 'StockNum'])),
    vin: str(pick(h, ['VIN', 'Vin', 'SerialNumber', 'HullNumber'])),
    color: str(pick(h, ['Color', 'ExteriorColor', 'PrimaryColor'])),
    usage: miles ? `${miles} mi` : hours ? `${hours} hrs` : null,
    location: str(pick(h, ['DealershipName', 'Location', 'StoreName'])),
    image: absolute(firstImage(pick(h, ['ImageUrl', 'PrimaryImage', 'Image', 'MainImage', 'Photo', 'Images', 'ImageUrls', 'Photos', 'Media'])) ?? findPhoto(h)),
    url: absolute(str(pick(h, ['DetailUrl', 'DetailsUrl', 'ProductUrl', 'Url', 'Link', 'SeoUrl', 'VehicleUrl']))),
    raw: h,
  };
}

export function toVehicleRef(u: Unit): VehicleRef {
  return { id: u.id, title: u.title, stock: u.stock, vin: u.vin, price: u.price, image: u.image, url: u.url };
}

export const money = (n: number | null) => (n ? `$${Math.round(n).toLocaleString('en-US')}` : 'Call for price');

/** The filters worth showing, from the facets the index returns. */
export function usefulFacets(facets: SearchResult['facets']): { name: string; label: string; values: [string, number][] }[] {
  const WANT: [RegExp, string][] = [
    [/^(condition|usage|newused)$/i, 'Condition'],
    [/^(producttype|type|vehicletype)$/i, 'Type'],
    [/^(category|industry)$/i, 'Category'],
    [/^(manufacturer|make|brand)$/i, 'Make'],
    [/^(year|modelyear)$/i, 'Year'],
  ];
  const out: { name: string; label: string; values: [string, number][] }[] = [];
  for (const [re, label] of WANT) {
    const name = Object.keys(facets).find((k) => re.test(k));
    if (!name || out.some((o) => o.label === label)) continue;
    const values = Object.entries(facets[name]).sort((a, b) => (label === 'Year' ? b[0].localeCompare(a[0]) : b[1] - a[1]));
    if (values.length > 1) out.push({ name, label, values });
  }
  return out;
}
