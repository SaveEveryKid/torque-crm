import type { Mail } from './mailMatch';

/** The bits of pst-extractor's PSTFolder / PSTMessage used here. */
interface PstMessage {
  messageClass: string;
  subject: string;
  senderEmailAddress: string;
  senderAddrtype: string;
  senderName: string;
  transportMessageHeaders: string;
  internetMessageId: string;
  body: string;
  messageDeliveryTime: Date | null;
  clientSubmitTime: Date | null;
}
interface PstFolder {
  hasSubfolders: boolean;
  contentCount: number;
  getSubFolders(): PstFolder[];
  getNextChild(): PstMessage | null;
}

export interface ExtractOptions {
  /** Only emails that arrived on or after this (ISO). */
  since: string;
  /** Sender addresses (lower case) and business domains to keep; bounces are always kept. */
  emails: Set<string>;
  domains: Set<string>;
  onProgress?: (read: number) => void;
}

const BOUNCE_FROM = /^(postmaster|mailer-daemon|microsoftexchange)/i;
const BOUNCE_SUBJECT = /^\s*(undeliverable|undelivered|delivery|mail delivery|returned mail|failure notice|message not delivered)/i;

/** The sender's real address (Exchange senders: from the headers). */
function fromOf(m: PstMessage): string {
  if (/smtp/i.test(m.senderAddrtype ?? '') && (m.senderEmailAddress ?? '').includes('@')) return m.senderEmailAddress.trim().toLowerCase();
  const h = /^from:.*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/im.exec(m.transportMessageHeaders ?? '');
  return (h?.[1] ?? m.senderEmailAddress ?? '').trim().toLowerCase();
}

/** Walk the exported folders and keep only what could be a customer's reply or a bounce. */
export function extractMails(root: PstFolder, o: ExtractOptions): { mails: Mail[]; total: number } {
  const mails: Mail[] = [];
  let total = 0;
  const walk = (folder: PstFolder) => {
    if (folder.hasSubfolders) for (const c of folder.getSubFolders()) walk(c);
    if (folder.contentCount <= 0) return;
    for (let m = folder.getNextChild(); m; m = folder.getNextChild()) {
      total++;
      if (total % 200 === 0) o.onProgress?.(total);
      const cls = String(m.messageClass ?? '');
      const at = (m.messageDeliveryTime ?? m.clientSubmitTime)?.toISOString?.() ?? '';
      if (!at || at < o.since || !(/^IPM\.Note/i.test(cls) || /^REPORT\./i.test(cls))) continue;
      const from = fromOf(m);
      const subject = String(m.subject ?? '');
      const report = /^REPORT\./i.test(cls);
      if (!(report || BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject) || o.emails.has(from) || o.domains.has(from.split('@')[1] ?? ''))) continue;
      mails.push({ id: String(m.internetMessageId || `${from}|${at}|${subject}`), subject, from, fromName: String(m.senderName ?? '').trim(), at, text: String(m.body ?? '').slice(0, 6000), ...(report ? { report } : {}) });
    }
  };
  walk(root);
  return { mails, total };
}
