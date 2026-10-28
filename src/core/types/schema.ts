/**
 * Data schema for the whole pipeline. See docs/ARCHITECTURE.md §5.
 *
 * Naming convention: anything under `CustomerRecord` is LOCAL ONLY.
 * `AIInput` is the only shape that may be sent to the AI proxy.
 */

export type PageType =
  | 'ACTIVE_PROSPECTS'
  | 'OPPORTUNITY_DETAILS'
  | 'CONTACT_HISTORY'
  /** Quick Find results (…/search/searchresults.asp). Read-only list of matches. */
  | 'SEARCH_RESULTS'
  | 'ELEAD_LOGIN'
  | 'OTHER_ELEAD'
  | 'NOT_ELEAD';

export interface PageDetection {
  pageType: PageType;
  /** 0..1 */
  confidence: number;
  /** Human-readable reasons, e.g. 'heading:"Opportunity Details"'. No customer data. */
  signals: string[];
  url: string;
  frameId?: number;
  detectedAt: string;
}

/* ---------- Extraction (LOCAL ONLY) ---------- */

export interface ProspectListRow {
  rowKey: string;
  opportunityId: string;
  personId: string | null;
  name: string;
  dateIn: string | null;
  /** As shown in the list. LOCAL ONLY. */
  phone: string | null;
  priority: string | null;
  scheduled: string | null;
  vehicle: string | null;
  salesperson: string | null;
  source: string | null;
  /** Read from the row's link; already passed the navigation allow-list. */
  detailUrl: string;
}

export type ActivityDirection = 'INBOUND' | 'OUTBOUND' | 'INTERNAL' | 'UNKNOWN';
export type ActivityChannel = 'TEXT' | 'PHONE' | 'EMAIL' | 'APPOINTMENT' | 'NOTE' | 'OTHER';

export interface ActivityRow {
  at: string | null;
  rawDate: string;
  type: string;
  outcome: string | null;
  comment: string | null;
  completedBy: string | null;
  channel: ActivityChannel;
  direction: ActivityDirection;
}

export interface ScheduledActivity {
  dueAt: string | null;
  rawDate: string;
  type: string;
  description: string | null;
  assignedTo: string | null;
}

export interface ParseReport {
  ok: boolean;
  confidence: number;
  sectionsFound: string[];
  warnings: string[];
  /** False when we cannot prove we saw the full activity history. */
  historyComplete: boolean;
}

export interface PhoneNumber {
  /** 'cell' | 'home' | 'work' */
  kind: string;
  number: string;
}

export interface SalesStep {
  name: string;
  done: boolean;
}

export interface CustomerRecord {
  recordKey: string;
  extractedAt: string;
  sourceUrl: string;
  /** IDs from the Opportunity Details URL (lDID / lPID). LOCAL ONLY. */
  crmIds: { opportunityId: string | null; personId: string | null };
  customer: {
    fullName: string;
    firstName: string;
    customerId: string | null;
    phones: PhoneNumber[];
    emails: string[];
    preferredContact: string | null;
    textPreferred: boolean | null;
    /** eLead shows a "Do not text" indicator next to the phone. Blocks SMS drafts. */
    doNotText: boolean | null;
    highPriority: boolean | null;
    lastModified: string | null;
    priority: string | null;
  };
  opportunity: {
    vehicle: string | null;
    stockNumber: string | null;
    trade: string | null;
    salesperson: string | null;
    upType: string | null;
    provider: string | null;
    leadSource: string | null;
    subSource: string | null;
    dateIn: string | null;
    dueDate: string | null;
    salesStatus: string | null;
    showroomStatus: string | null;
    salesSteps: SalesStep[];
  };
  /** eLead's own AI summary bullets. Read but never authoritative. */
  crmAiSummary: string | null;
  /** e.g. "28 days ago" — eLead's summary can be stale. */
  crmAiSummaryUpdated: string | null;
  scheduled: ScheduledActivity[];
  /** Newest first, as eLead lists it. */
  history: ActivityRow[];
  parseReport: ParseReport;
}

/* ---------- Contact safety ---------- */

export interface Suppression {
  suppressed: boolean;
  /** e.g. "Customer requested no further contact." */
  reason: string | null;
  /** Which local rules fired, e.g. 'inbound:STOP'. */
  triggers: string[];
}

/* ---------- Audit ---------- */

export type AuditKind =
  | 'PAGE_READ' | 'CUSTOMER_PARSED' | 'NAVIGATION' | 'NAVIGATION_REFUSED'
  | 'EXPORT_CREATED' | 'WRITE_BLOCKED' | 'MESSAGE_REJECTED' | 'LOCAL_DATA_DELETED' | 'BACKUP_RESTORED';

export interface AuditEvent {
  at: string;
  kind: AuditKind;
  /** Technical detail only. Never names, phones, emails or comments. */
  detail: string;
  /** Hashed record key, when relevant. */
  recordRef?: string;
}
