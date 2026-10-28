import { normalizeUsPhone } from './phone';

/**
 * CUSTOM LIST: a call list you upload (CSV), dialed instead of eLead's Active Prospects.
 * Pure and local: the file is read in the side panel and kept in this browser.
 * Nothing here reads from or writes to eLead.
 *
 * Columns are found by header name (any order, any case):
 *   name     Customer | Name | Customer Name | Full Name   (or First Name + Last Name)
 *   phone    Phone | Cell | Mobile | Phone Number | Primary Phone | Cell Phone
 *   alt      Alt Phone | Alternate Phone | Phone 2 | Home Phone | Work Phone   (also "Alt phone: 2565551234" inside Notes)
 *   vehicle  Vehicle | Car | Model
 *   notes    Notes | Note | Comments
 *
 * Skipped (with the reason shown): no phone, invalid phone (never guessed or
 * repaired), duplicate phone (first row kept). If the main number can't be
 * dialed but a valid alt phone is in the row, the alt phone is dialed.
 */
export interface CustomListEntry {
  /** Stable local id ("list:+12565551234"), so "already called today" works across re-uploads. */
  id: string;
  name: string;
  e164: string;
  phone: string;
  /** Display form of the other number in the row, if any. */
  altPhone: string | null;
  /** True when the main number couldn't be dialed and the alt phone is used. */
  usingAlt: boolean;
  vehicle: string | null;
  notes: string | null;
  /** Line in the file (1 = header). */
  line: number;
}

export type CustomSkipReason = 'NO_PHONE' | 'INVALID_PHONE' | 'DUPLICATE';

export interface CustomListSkipped {
  name: string;
  line: number;
  reason: CustomSkipReason;
  detail: string;
}

export interface CustomList {
  fileName: string;
  importedAt: string;
  entries: CustomListEntry[];
  skipped: CustomListSkipped[];
  /** What kind of customers this list is (picked on the Follow-ups tab before drafting). */
  listType?: ListType | null;
  /** Anything else Claude should know about this list, in your words. */
  listNote?: string | null;
}

/**
 * LIST TYPES: the whole custom list is one kind of customer. The type tells
 * Claude what the follow-up is for, before it reads each customer's history.
 */
export type ListType =
  | 'first_contact'
  | 'warm'
  | 'cold'
  | 'expired_lead'
  | 'unsold_showroom'
  | 'missed_appt'
  | 'prior_sold'
  | 'orphan'
  | 'lease_end'
  | 'equity'
  | 'service'
  | 'other';

export const LIST_TYPES: Record<ListType, { label: string; hint: string }> = {
  first_contact: {
    label: 'New leads: first contact',
    hint: "New leads we haven't really talked to yet. Open the safety gate: recognition and one easy question about their situation. No appointment ask in the first message.",
  },
  warm: {
    label: 'Warm list: recent conversations',
    hint: 'Customers we talked with recently who are still deciding. Pick up where the conversation stopped and make the next small move toward a visit.',
  },
  cold: {
    label: 'Cold list: never engaged',
    hint: "Customers who never really engaged. Assume no relationship: say who you are, give one specific, honest reason for reaching out, and make it easy to say no. Never pretend we've talked before.",
  },
  expired_lead: {
    label: 'Expired / old leads to re-engage',
    hint: 'Leads that went quiet weeks or months ago. No guilt about the silence. Acknowledge time has passed, ask whether they found something or are still looking, and offer a fresh, low-pressure reason to talk.',
  },
  unsold_showroom: {
    label: 'Unsold showroom / be-backs',
    hint: "They visited and didn't buy. Reference the visit and what they looked at. Find out what stopped them (often price, payment, trade or timing) and offer to solve that one thing.",
  },
  missed_appt: {
    label: 'Missed appointments / no-shows',
    hint: 'They set an appointment and missed it. Zero guilt ("totally understand if something came up"). Offer to pick another time with an easy out.',
  },
  prior_sold: {
    label: 'Previous sold customers (owners)',
    hint: 'They already bought from us. Lead with the relationship (how is the vehicle treating them), not a sale. Offer value: a trade-in value check, an upgrade only if it fits their history, or simply being their person at the dealership. Never assume they want a new car.',
  },
  orphan: {
    label: 'Orphan owners (their salesperson left)',
    hint: 'They bought here, but their salesperson is gone. Introduce yourself as their new contact at the dealership, offer help with anything they need, and keep it about service and the relationship.',
  },
  lease_end: {
    label: 'Lease ending',
    hint: 'Their lease is ending soon. Help them understand their options (turn it in, buy it out, or a new one) and offer to walk them through it before the deadline. Never invent dates, buyout amounts or payments.',
  },
  equity: {
    label: 'Equity / trade-up',
    hint: 'Owners who may be able to trade into something newer. Offer a free, no-pressure look at what their vehicle is worth. Never state a trade value, payment or amount unless it is written in the history or list note.',
  },
  service: {
    label: 'Service customers',
    hint: 'Customers who service with us. Keep it light and helpful. Mention options only as a no-pressure "if you ever want to see what yours is worth".',
  },
  other: {
    label: 'Other (describe it below)',
    hint: 'Follow the list description below.',
  },
};

/** What Claude is told about the list (empty if no type was picked). */
export function listContext(list: CustomList | null): string {
  if (!list?.listType) return '';
  const t = LIST_TYPES[list.listType];
  const note = list.listNote?.trim().slice(0, 800);
  return [`LIST TYPE: ${t.label}. ${t.hint}`, note ? `ABOUT THIS LIST (from the salesperson): ${note}` : ''].filter(Boolean).join('\n') + '\n\n';
}

export type ImportResult = { ok: true; list: CustomList } | { ok: false; error: string };

/** RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADERS = {
  name: ['customer', 'name', 'customername', 'fullname', 'contact', 'contactname'],
  first: ['firstname', 'first'],
  last: ['lastname', 'last'],
  phone: ['phone', 'cell', 'mobile', 'phonenumber', 'primaryphone', 'cellphone', 'mobilephone', 'telephone'],
  alt: ['altphone', 'alternatephone', 'phone2', 'secondaryphone', 'homephone', 'workphone', 'otherphone'],
  vehicle: ['vehicle', 'car', 'model', 'vehicleofinterest'],
  notes: ['notes', 'note', 'comments', 'comment'],
} as const;

const clean = (s: string | undefined) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim().replace(/^[,|\s]+|[,|\s]+$/g, '');
  return t || null;
};

const ALT_IN_NOTES = /\balt(?:ernate)?\.?\s*phone\s*[:#-]?\s*([()\d\s.+-]{10,20})/i;

export function importCustomList(text: string, fileName: string, now = new Date()): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: 'The file has no customer rows. It needs a header row (Customer, Phone, …) and one row per customer.' };
  const header = rows[0].map(norm);
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const c = {
    name: col(HEADERS.name),
    first: col(HEADERS.first),
    last: col(HEADERS.last),
    phone: col(HEADERS.phone),
    alt: col(HEADERS.alt),
    vehicle: col(HEADERS.vehicle),
    notes: col(HEADERS.notes),
  };
  if (c.phone < 0) return { ok: false, error: `No phone column found. The first row should name the columns, e.g. "Customer,Phone,Vehicle,Notes". Found: ${rows[0].join(', ')}` };
  if (c.name < 0 && c.first < 0 && c.last < 0) return { ok: false, error: 'No customer name column found (Customer, Name, or First Name / Last Name).' };

  const entries: CustomListEntry[] = [];
  const skipped: CustomListSkipped[] = [];
  const seen = new Map<string, string>();

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k: number) => (k >= 0 ? clean(r[k]) : null);
    const name = get(c.name) ?? ([get(c.first), get(c.last)].filter(Boolean).join(' ') || `Row ${line}`);
    const notes = get(c.notes);
    const rawMain = get(c.phone);
    const rawAlt = get(c.alt) ?? clean(notes?.match(ALT_IN_NOTES)?.[1]);
    const main = rawMain ? normalizeUsPhone(rawMain) : null;
    const alt = rawAlt ? normalizeUsPhone(rawAlt) : null;

    let dial: { e164: string; display: string } | null = null;
    let usingAlt = false;
    if (main?.ok) dial = main;
    else if (alt?.ok) {
      dial = alt;
      usingAlt = true;
    }
    if (!dial) {
      if (!rawMain && !rawAlt) skipped.push({ name, line, reason: 'NO_PHONE', detail: 'No phone number in this row.' });
      else
        skipped.push({
          name,
          line,
          reason: 'INVALID_PHONE',
          detail: `Can't dial ${rawMain ?? rawAlt}${main && !main.ok ? ` (${main.reason})` : ''}.`,
        });
      return;
    }
    const firstName = seen.get(dial.e164);
    if (firstName !== undefined) {
      skipped.push({ name, line, reason: 'DUPLICATE', detail: `Same number as ${firstName}, who is earlier in the list.` });
      return;
    }
    seen.set(dial.e164, name);
    const other = usingAlt ? (main?.ok ? main.display : rawMain) : alt?.ok ? alt.display : rawAlt;
    entries.push({
      id: `list:${dial.e164}`,
      name,
      e164: dial.e164,
      phone: dial.display,
      altPhone: other && other !== dial.display ? other : null,
      usingAlt,
      vehicle: get(c.vehicle),
      notes,
      line,
    });
  });

  return { ok: true, list: { fileName, importedAt: now.toISOString(), entries, skipped } };
}

export interface ManualCustomer {
  name: string;
  phone: string;
  altPhone?: string;
  vehicle?: string;
  notes?: string;
}

/**
 * ADD A CUSTOMER by hand (Queue page). Same phone rules as an uploaded file:
 * the number must be dialable (never guessed or repaired) and not already on
 * the list. With no list yet, a new one named "Added by hand" is started.
 */
export function addCustomEntry(
  list: CustomList | null,
  c: ManualCustomer,
  now = new Date(),
): { ok: true; list: CustomList; entry: CustomListEntry } | { ok: false; error: string } {
  const name = c.name.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Type the customer’s name.' };
  const main = normalizeUsPhone(c.phone.trim());
  if (!main.ok) return { ok: false, error: `Can't dial ${c.phone.trim() || 'that number'}${main.reason ? ` (${main.reason})` : ''}.` };
  const base: CustomList = list ?? { fileName: 'Added by hand', importedAt: now.toISOString(), entries: [], skipped: [] };
  const dup = base.entries.find((e) => e.e164 === main.e164);
  if (dup) return { ok: false, error: `${dup.name} already has that number on this list.` };
  const alt = c.altPhone?.trim() ? normalizeUsPhone(c.altPhone.trim()) : null;
  const entry: CustomListEntry = {
    id: `list:${main.e164}`,
    name,
    e164: main.e164,
    phone: main.display,
    altPhone: alt?.ok ? alt.display : c.altPhone?.trim() || null,
    usingAlt: false,
    vehicle: c.vehicle?.trim() || null,
    notes: c.notes?.trim() || null,
    line: Math.max(1, ...base.entries.map((e) => e.line), ...base.skipped.map((s) => s.line)) + 1,
  };
  return { ok: true, list: { ...base, entries: [...base.entries, entry] }, entry };
}
