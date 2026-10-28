import type { CustomerRecord } from '../types/schema';
import { parseCsv, type CustomList } from './customList';

/** Imported eLead history, by list entry id. */
export type CustomLinks = Record<string, { record: CustomerRecord; linkedAt: string }>;
import { buildCallContext } from './callContext';

/**
 * CUSTOM LIST BACKUP (CSV): your list plus the eLead history Torque read for
 * each customer. Upload it again later (Settings → Call list) and the history
 * comes back without re-reading eLead.
 *
 * Normal columns (open fine in Excel): Customer, Phone, Alt Phone, Vehicle,
 * Notes, Email, Lead Source, Last Customer Reply, Last Reply Date. The history
 * itself is in the "Torque Data" column. Excel cuts cells longer than 32,767
 * characters, so each one is kept under 30,000 (oldest history dropped first),
 * but don't edit and re-save the file in Excel: that can still damage it.
 */
export const TORQUE_DATA_HEADER = 'Torque Data';
const CELL_LIMIT = 30_000;
const COMMENT_LIMIT = 600;

const csvCell = (v: string | null | undefined) => {
  const s = (v ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The record, trimmed to fit one spreadsheet cell: newest history kept. */
export function packRecord(record: CustomerRecord): string {
  const history = [...record.history]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .map((h) => ({ ...h, comment: h.comment && h.comment.length > COMMENT_LIMIT ? `${h.comment.slice(0, COMMENT_LIMIT - 1)}…` : h.comment }));
  for (let keep = history.length; keep >= 0; keep = keep > 20 ? Math.floor(keep * 0.8) : keep - 1) {
    const json = JSON.stringify({ ...record, history: history.slice(0, keep) });
    if (json.length <= CELL_LIMIT) return json;
  }
  return JSON.stringify({ ...record, history: [] });
}

export function exportCustomListCsv(list: CustomList, links: CustomLinks, removed: Set<string>): string {
  const header = ['Customer', 'Phone', 'Alt Phone', 'Vehicle', 'Notes', 'Email', 'Lead Source', 'Last Customer Reply', 'Last Reply Date', TORQUE_DATA_HEADER];
  const lines = [header.join(',')];
  for (const e of list.entries) {
    if (removed.has(e.id)) continue;
    const record = links[e.id]?.record ?? null;
    const ctx = record ? buildCallContext(record) : null;
    lines.push(
      [
        e.name,
        e.phone,
        e.altPhone,
        e.vehicle ?? record?.opportunity.vehicle ?? null,
        e.notes,
        record?.customer.emails[0] ?? null,
        record?.opportunity.leadSource ?? null,
        ctx?.lastCustomerResponse?.text ?? null,
        ctx?.lastCustomerResponse?.at?.slice(0, 10) ?? null,
        record ? packRecord(record) : null,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

const looksLikeRecord = (v: unknown): v is CustomerRecord => {
  const r = v as CustomerRecord;
  return !!r && typeof r === 'object' && typeof r.customer?.fullName === 'string' && Array.isArray(r.history) && typeof r.opportunity === 'object' && Array.isArray(r.customer?.phones);
};

/** History saved by Torque in an uploaded file, by file line (matches CustomListEntry.line). Unreadable cells are skipped. */
export function readTorqueData(text: string): Map<number, CustomerRecord> {
  const rows = parseCsv(text);
  const out = new Map<number, CustomerRecord>();
  const col = (rows[0] ?? []).findIndex((h) => h.trim().toLowerCase() === TORQUE_DATA_HEADER.toLowerCase());
  if (col < 0) return out;
  rows.slice(1).forEach((r, i) => {
    const cell = r[col]?.trim();
    if (!cell) return;
    try {
      const v: unknown = JSON.parse(cell);
      if (looksLikeRecord(v)) out.set(i + 2, v);
    } catch {
      // damaged cell (e.g. cut by Excel): that customer just has no saved history
    }
  });
  return out;
}

export function customListFileName(list: CustomList, now = new Date()): string {
  const base = list.fileName.replace(/\.csv$/i, '').replace(/-torque-\d{4}-\d{2}-\d{2}$/, '');
  return `${base}-torque-${now.toISOString().slice(0, 10)}.csv`;
}
