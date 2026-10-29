import type { ActivityRow, CustomerRecord } from '../core/types/schema';
import { importCustomList } from '../core/analysis/customList';
import { readTorqueData } from '../core/analysis/customExport';
import { normalizeUsPhone } from '../core/analysis/phone';
import { activity, blankCustomer, formatPhone } from './store';
import { STAGE_LABEL, type Activity, type Customer, type Stage } from './types';

/**
 * Bridges between the CRM and Torque's AI modules, which read a
 * CustomerRecord (the shape Torque built from eLead).
 */
const TYPE: Record<Activity['channel'], string> = {
  TEXT: 'Text',
  PHONE: 'Phone call',
  EMAIL: 'Email',
  APPOINTMENT: 'Appointment',
  NOTE: 'Note',
  OTHER: 'Activity',
};

function rawDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function toRow(a: Activity, me: string): ActivityRow {
  return {
    at: a.at,
    rawDate: rawDate(a.at),
    type: a.outcome === 'Stage' ? 'Status change' : TYPE[a.channel],
    outcome: a.outcome === 'Stage' ? null : a.outcome,
    comment: a.text || null,
    completedBy: a.direction === 'OUTBOUND' ? me : null,
    channel: a.channel,
    direction: a.direction,
  };
}

/** The customer as Torque's AI reads them. */
export function toRecord(c: Customer, me: string): CustomerRecord {
  const fullName = `${c.firstName} ${c.lastName}`.trim();
  const phones = [c.phone && { kind: 'cell', number: c.phone }, c.altPhone && { kind: 'home', number: c.altPhone }].filter(Boolean) as CustomerRecord['customer']['phones'];
  const vehicle = c.vehicle?.title || c.interest || null;
  return {
    recordKey: c.id,
    extractedAt: new Date().toISOString(),
    sourceUrl: '',
    crmIds: { opportunityId: c.id, personId: c.id },
    customer: {
      fullName,
      firstName: c.firstName,
      customerId: c.id,
      phones,
      emails: c.email ? [c.email] : [],
      preferredContact: null,
      textPreferred: null,
      doNotText: c.doNotText,
      highPriority: null,
      lastModified: c.updatedAt,
      priority: null,
    },
    opportunity: {
      vehicle: [vehicle, c.vehicle?.price ? `$${c.vehicle.price.toLocaleString()}` : null].filter(Boolean).join(', ') || null,
      stockNumber: c.vehicle?.stock ?? null,
      trade: c.trade || null,
      salesperson: me,
      upType: null,
      provider: null,
      leadSource: c.source || null,
      subSource: null,
      dateIn: c.createdAt,
      dueDate: null,
      salesStatus: c.stage === 'sold' ? 'Sold' : c.stage === 'lost' ? 'Lost' : STAGE_LABEL[c.stage],
      showroomStatus: null,
      salesSteps: [],
    },
    crmAiSummary:
      [
        c.notes && `Salesperson's notes: ${c.notes}`,
        c.needs && `What they want it for: ${[c.needs.use, c.needs.tags.join(', '), c.needs.riders && `riders: ${c.needs.riders}`].filter(Boolean).join('; ')}`,
        c.match?.picks.length && `Units suggested to them: ${c.match.picks.map((p) => p.v.title).join('; ')}`,
      ]
        .filter(Boolean)
        .join('\n') || null,
    crmAiSummaryUpdated: null,
    scheduled: c.tasks
      .filter((t) => !t.done)
      .map((t) => ({ dueAt: t.dueAt, rawDate: rawDate(t.dueAt), type: t.kind === 'appointment' ? 'Appointment' : t.title, description: t.title, assignedTo: me })),
    history: c.activities.map((a) => toRow(a, me)),
    parseReport: { ok: true, confidence: 1, sectionsFound: ['crm'], warnings: [], historyComplete: true },
  };
}

function stageFromStatus(status: string | null): Stage {
  if (!status) return 'new';
  if (/sold|delivered/i.test(status)) return 'sold';
  if (/lost|dead|bought elsewhere|inactive/i.test(status)) return 'lost';
  return 'contacted';
}

/** A customer Torque read from eLead (with full history) becomes a CRM customer. */
export function fromRecord(r: CustomerRecord, extra: Partial<Customer> = {}): Customer {
  const [first, ...rest] = (r.customer.fullName.includes(',') ? r.customer.fullName.split(',').reverse().join(' ') : r.customer.fullName).trim().split(/\s+/);
  const phones = r.customer.phones.map((p) => p.number).filter((n) => normalizeUsPhone(n).ok);
  return blankCustomer({
    firstName: r.customer.firstName || first || '',
    lastName: rest.join(' '),
    phone: phones[0] ? formatPhone(phones[0]) : '',
    altPhone: phones[1] ? formatPhone(phones[1]) : '',
    email: r.customer.emails[0] ?? '',
    source: [r.opportunity.leadSource, r.opportunity.subSource].filter(Boolean).join(' / '),
    stage: stageFromStatus(r.opportunity.salesStatus),
    interest: r.opportunity.vehicle ?? '',
    trade: r.opportunity.trade ?? '',
    doNotText: Boolean(r.customer.doNotText),
    createdAt: r.opportunity.dateIn ?? new Date().toISOString(),
    activities: r.history
      .filter((h) => h.at)
      .map((h) =>
        activity({
          at: h.at!,
          channel: h.channel,
          direction: h.direction,
          outcome: [h.type, h.outcome].filter(Boolean).join(' · ') || null,
          text: h.comment ?? '',
          imported: true,
        }),
      )
      .sort((a, b) => b.at.localeCompare(a.at)),
    ...extra,
  });
}

export type ImportOutcome = { ok: true; customers: Customer[]; withHistory: number; skipped: number; duplicates: number } | { ok: false; error: string };

/**
 * Import a CSV: any spreadsheet with name and phone columns (eLead exports work),
 * or a Torque "EXPORT LIST + HISTORY" backup, which brings each customer's
 * full eLead history with it. Customers whose phone is already in the CRM are skipped.
 */
export function importCsv(text: string, fileName: string, existing: Customer[]): ImportOutcome {
  const res = importCustomList(text, fileName);
  if (!res.ok) return res;
  const history = readTorqueData(text);
  const known = new Set(existing.flatMap((c) => [c.phone, c.altPhone]).map((p) => normalizeUsPhone(p)).flatMap((n) => (n.ok ? [n.digits] : [])));
  const customers: Customer[] = [];
  let duplicates = 0;
  for (const e of res.list.entries) {
    const digits = normalizeUsPhone(e.phone);
    if (digits.ok && known.has(digits.digits)) {
      duplicates++;
      continue;
    }
    if (digits.ok) known.add(digits.digits);
    const rec = history.get(e.line);
    const [first, ...rest] = e.name.split(/\s+/);
    const base = { firstName: first ?? '', lastName: rest.join(' '), phone: e.phone, altPhone: e.altPhone ?? '', interest: e.vehicle ?? '', notes: e.notes ?? '', source: `Import: ${fileName}` };
    customers.push(rec ? fromRecord(rec, base) : blankCustomer(base));
  }
  return { ok: true, customers, withHistory: customers.filter((c) => c.activities.length).length, skipped: res.list.skipped.length, duplicates };
}
