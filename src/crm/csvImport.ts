import { parseCsv } from '../core/analysis/customList';
import { readTorqueData } from '../core/analysis/customExport';
import { normalizeUsPhone } from '../core/analysis/phone';
import { fromRecord } from './record';
import { blankCustomer, formatPhone } from './store';
import { STAGES, type Customer, type Stage } from './types';

/**
 * IMPORT CUSTOMERS FROM A SPREADSHEET (CSV). Any column names: the columns
 * are matched to CRM fields by their header, and you can fix any match before
 * importing. A row is someone already in the CRM when the name matches and so
 * does the phone or email (people at one company often share its main line,
 * so a phone alone isn't enough; a row with no person's name matches on the
 * business name + phone). Those are skipped, or, if you choose, get their
 * blank fields filled in. A Torque
 * "EXPORT LIST + HISTORY" file also brings each customer's eLead history.
 */
export type Field =
  | 'ignore'
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'title'
  | 'phone'
  | 'altPhone'
  | 'email'
  | 'street'
  | 'city'
  | 'state'
  | 'zip'
  | 'interest'
  | 'trade'
  | 'notes'
  | 'source'
  | 'stage'
  | 'doNotText';

export const FIELDS: { id: Field; label: string }[] = [
  { id: 'ignore', label: '— Don’t import —' },
  { id: 'fullName', label: 'Full name' },
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'company', label: 'Business name' },
  { id: 'title', label: 'Job title' },
  { id: 'phone', label: 'Phone' },
  { id: 'altPhone', label: 'Other phone' },
  { id: 'email', label: 'Email' },
  { id: 'street', label: 'Address' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'zip', label: 'Zip' },
  { id: 'interest', label: 'Looking for' },
  { id: 'trade', label: 'Trade' },
  { id: 'notes', label: 'Notes' },
  { id: 'source', label: 'Source' },
  { id: 'stage', label: 'Stage' },
  { id: 'doNotText', label: 'Do not text (yes/no)' },
];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header words for each field, most specific first. */
const GUESS: [Field, RegExp][] = [
  ['firstName', /^(first|firstname|fname|givenname|customerfirstname|buyerfirstname)$/],
  ['lastName', /^(last|lastname|lname|surname|familyname|customerlastname|buyerlastname)$/],
  ['fullName', /^(name|customer|customername|fullname|contact|contactname|buyer|buyername|client|clientname)$/],
  ['company', /^(business|businessname|company|companyname|organization|organisation|org|account|accountname|employer|firm|dealer)$/],
  ['title', /^(title|jobtitle|position|role)$/],
  ['email', /e?mail/],
  ['altPhone', /(alt|alternate|other|second|secondary|home|work|business|evening|day)(phone|number|tel)|phone2|cell2/],
  ['phone', /phone|cell|mobile|tel|number/],
  ['street', /^(address|street|address1|streetaddress|addressline1|mailingaddress|location|fulladdress)$/],
  ['city', /^(city|town)$/],
  ['state', /^(state|st|province)$/],
  ['zip', /^(zip|zipcode|postal|postalcode)$/],
  ['interest', /vehicle|interest|lookingfor|model|unit|soughtvehicle|desiredvehicle|product/],
  ['trade', /trade/],
  ['notes', /note|comment|remark|description/],
  ['source', /source|leadsource|origin|campaign|leadtype/],
  ['stage', /stage|status|leadstatus/],
  ['doNotText', /donottext|dnt|optout|nosms|donotcontact|dnc/],
];

/** Best guess of each column's field from its header. Each field (but Notes) is used once. */
export function guessMapping(headers: string[]): Field[] {
  const used = new Set<Field>();
  return headers.map((h) => {
    const n = norm(h);
    if (!n || n === 'torquedata') return 'ignore';
    for (const [f, re] of GUESS) {
      if (!re.test(n)) continue;
      // A second phone column becomes the other phone.
      const field = f === 'phone' && used.has('phone') ? 'altPhone' : f;
      if (used.has(field) && field !== 'notes') continue;
      used.add(field);
      return field;
    }
    return 'ignore';
  });
}

export interface Sheet {
  headers: string[];
  /** Data rows with their line in the file (1 = header). */
  rows: { line: number; cells: string[] }[];
}

export function readSheet(text: string): Sheet | { error: string } {
  const all = parseCsv(text.replace(/^﻿/, ''));
  // Excel sometimes writes "sep=," as the first line.
  const start = /^sep=.?$/i.test((all[0] ?? []).join(',').trim()) ? 1 : 0;
  const headers = (all[start] ?? []).map((h) => h.trim());
  if (!headers.some(Boolean)) return { error: 'This file is empty. It needs a first row naming the columns (Name, Phone, Email…) and one row per customer.' };
  const rows = all
    .slice(start + 1)
    .map((cells, i) => ({ line: start + i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim()));
  if (!rows.length) return { error: 'The file has a header row but no customers under it.' };
  return { headers, rows };
}

export interface ImportOptions {
  fileName: string;
  /** Stage for rows without one. */
  stage: Stage;
  /** Source for rows without one. */
  source: string;
  /** Customers already here: fill in their blank fields (true) or leave them alone (false). */
  fillExisting: boolean;
}

export interface ImportPlan {
  add: Customer[];
  /** Customers already here, with the blank fields this file fills in. */
  update: { id: string; name: string; patch: Partial<Customer> }[];
  /** Already here, and nothing to change (or "fill in" is off). */
  unchanged: number;
  /** In the file twice: the later row was merged into the first. */
  repeats: number;
  skipped: { line: number; reason: string }[];
  /** Phones kept as typed because they aren't a valid US number. */
  oddPhones: number;
  withHistory: number;
}

const STAGE_WORDS: [Stage, RegExp][] = [
  ['sold', /sold|deliver|purchas|bought|won/],
  ['lost', /lost|dead|bad|inactive|closed|not interested|purchased elsewhere/],
  ['appointment', /appo?i?n?t|appt|scheduled/],
  ['showed', /show|visit|walk.?in|up\b/],
  ['working', /work|negotiat|desk|pencil|financ|pending/],
  ['contacted', /contact|called|spoke|talk|engaged|responded|replied|follow/],
  ['new', /new|fresh|open|lead|prospect/],
];
export function readStage(v: string): Stage | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  const exact = STAGES.find((s) => s.id === t || s.label.toLowerCase() === t);
  if (exact) return exact.id;
  return STAGE_WORDS.find(([, re]) => re.test(t))?.[0] ?? null;
}

const truthy = (v: string) => /^(y|yes|true|1|x|opt.?out|stop|dnt|dnc|do not text)$/i.test(v.trim());
const phoneKey = (p: string) => {
  const n = normalizeUsPhone(p);
  return n.ok ? n.digits : null;
};

/**
 * "Smith, John" → John / Smith; "John Q Smith" → John / Q Smith;
 * "Zach & Abby Smith" → Zach & Abby / Smith; "Steve / Ridge Construction"
 * (a name plus the business it's already filed under) → Steve.
 */
export function splitName(full: string, company = ''): { firstName: string; lastName: string } {
  let t = full.replace(/\s+/g, ' ').trim();
  const slash = t.split(/\s+\/\s+/);
  if (slash.length > 1 && companyKey(slash.slice(1).join(' ')) === companyKey(company)) t = slash[0];
  const comma = /^([^,]+),\s*(.+)$/.exec(t);
  if (comma) return { firstName: comma[2], lastName: comma[1] };
  const couple = /^(\S+ (?:&|and) \S+) (.+)$/i.exec(t);
  if (couple) return { firstName: couple[1], lastName: couple[2] };
  const [first = '', ...rest] = t.split(' ');
  return { firstName: first, lastName: rest.join(' ') };
}

const tidyName = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

const FILLABLE = ['firstName', 'lastName', 'company', 'title', 'phone', 'altPhone', 'email', 'address', 'interest', 'trade', 'source'] as const;
const nameKey = (c: Pick<Customer, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.replace(/\s+/g, ' ').trim().toLowerCase();
const companyKey = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function planImport(sheet: Sheet, mapping: Field[], existing: Customer[], opts: ImportOptions, torque = new Map<number, ReturnType<typeof readTorqueData> extends Map<number, infer R> ? R : never>()): ImportPlan {
  const byPhone = new Map<string, Customer[]>();
  const byEmail = new Map<string, Customer[]>();
  const push = (m: Map<string, Customer[]>, k: string, c: Customer) => m.set(k, [...(m.get(k) ?? []), c]);
  const index = (c: Customer) => {
    for (const p of [c.phone, c.altPhone]) {
      const k = phoneKey(p);
      if (k) push(byPhone, k, c);
    }
    if (c.email.trim()) push(byEmail, c.email.trim().toLowerCase(), c);
  };
  /** Same person (name + phone or email), or, with no person's name, same business + phone. */
  const find = (row: Partial<Customer>): Customer | undefined => {
    const name = nameKey(row as Customer);
    const viaPhone = [row.phone, row.altPhone].flatMap((p) => byPhone.get(phoneKey(p ?? '') ?? '') ?? []);
    const viaEmail = row.email ? byEmail.get(row.email) ?? [] : [];
    if (name) return [...viaPhone, ...viaEmail].find((c) => nameKey(c) === name);
    const biz = companyKey(row.company);
    return viaPhone.find((c) => !nameKey(c) && companyKey(c.company) === biz);
  };
  existing.forEach(index);
  const isNew = new Set<string>();

  const plan: ImportPlan = { add: [], update: [], unchanged: 0, repeats: 0, skipped: [], oddPhones: 0, withHistory: 0 };
  const updates = new Map<string, { id: string; name: string; patch: Partial<Customer> }>();
  const unchanged = new Set<string>();

  for (const { line, cells } of sheet.rows) {
    const get = (f: Field) =>
      mapping
        .map((m, i) => (m === f ? (cells[i] ?? '').replace(/\s+/g, ' ').trim() : ''))
        .filter(Boolean)
        .join(f === 'notes' ? '\n' : ' ');
    let { firstName, lastName } = { firstName: get('firstName'), lastName: get('lastName') };
    if (!firstName && !lastName && get('fullName')) ({ firstName, lastName } = splitName(get('fullName'), get('company')));
    firstName = tidyName(firstName);
    lastName = tidyName(lastName);
    const rawPhone = get('phone');
    const rawAlt = get('altPhone');
    const email = get('email').toLowerCase();
    const company = get('company');
    const who = `${firstName} ${lastName}`.trim() || company;
    if (!who) {
      plan.skipped.push({ line, reason: 'no name or business name' });
      continue;
    }
    if (!rawPhone && !rawAlt && !email) {
      plan.skipped.push({ line, reason: `${who}: no phone or email` });
      continue;
    }
    const phone = rawPhone ? formatPhone(rawPhone) : rawAlt ? formatPhone(rawAlt) : '';
    const altPhone = rawPhone && rawAlt ? formatPhone(rawAlt) : '';
    if ((phone && !phoneKey(phone)) || (altPhone && !phoneKey(altPhone))) plan.oddPhones++;
    const [street, city, state, zip] = [get('street'), get('city'), get('state'), get('zip')];
    const address = [street, [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    const row: Partial<Customer> = {
      firstName,
      lastName,
      company,
      title: get('title'),
      phone,
      altPhone,
      email,
      address,
      interest: get('interest'),
      trade: get('trade'),
      notes: get('notes'),
      source: get('source') || opts.source,
      stage: readStage(get('stage')) ?? opts.stage,
      doNotText: truthy(get('doNotText')),
    };

    const match = find(row);
    if (match) {
      if (isNew.has(match.id)) {
        // The same customer twice in this file: fill the first row's blanks.
        plan.repeats++;
        // Same person at a second number (another office): keep it as the other phone.
        if (row.phone && phoneKey(row.phone) !== phoneKey(match.phone) && !match.altPhone) match.altPhone = row.phone;
        for (const k of FILLABLE) if (!match[k] && row[k]) (match[k] as string) = row[k] as string;
        if (row.notes && !match.notes.includes(row.notes)) match.notes = [match.notes, row.notes].filter(Boolean).join('\n');
        continue;
      }
      const prev = updates.get(match.id)?.patch ?? {};
      const patch: Partial<Customer> = { ...prev };
      if (opts.fillExisting) {
        for (const k of FILLABLE) if (!match[k] && !patch[k] && row[k] && k !== 'source') (patch[k] as string) = row[k] as string;
        const notes = patch.notes ?? match.notes;
        if (row.notes && !notes.includes(row.notes)) patch.notes = [notes, row.notes].filter(Boolean).join('\n');
        if (row.doNotText && !match.doNotText) patch.doNotText = true;
      }
      if (Object.keys(patch).length) {
        updates.set(match.id, { id: match.id, name: `${match.firstName} ${match.lastName}`.trim() || match.company || match.phone, patch });
        unchanged.delete(match.id);
      } else if (!updates.has(match.id)) unchanged.add(match.id);
      continue;
    }

    const rec = torque.get(line);
    const c = rec ? fromRecord(rec, row) : blankCustomer(row);
    if (rec) plan.withHistory++;
    plan.add.push(c);
    isNew.add(c.id);
    index(c);
  }
  plan.update = [...updates.values()];
  plan.unchanged = unchanged.size;
  return plan;
}

/** Read a file and plan it with the guessed columns (also used by tests). */
export function quickPlan(text: string, existing: Customer[], opts: ImportOptions): ImportPlan | { error: string } {
  const sheet = readSheet(text);
  if ('error' in sheet) return sheet;
  return planImport(sheet, guessMapping(sheet.headers), existing, opts, readTorqueData(text));
}

export const SAMPLE_CSV =
  'Name,Business Name,Title,Phone Number,Email,Location,Looking For,Notes\r\n' +
  'John Smith,Smith Farms,Owner,(256) 555-0142,john@example.com,"120 Main St, Florence, AL",Ranger XP 1000,Needs two for the farm crew\r\n' +
  ',Valley Rentals,,256-555-0187,,"Muscle Shoals, AL",,Main line\r\n';
