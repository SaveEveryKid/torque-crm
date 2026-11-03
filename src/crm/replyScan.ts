import { findReplies, foundActivity, businessDomain, type Found, type Mail } from './mailMatch';
import type { PstReply, PstRequest } from './pstWorker';
import { stopSequence } from './sequence';
import { getCustomers, logActivity, updateCustomer } from './store';
import type { Customer } from './types';

/**
 * CHECK FOR REPLIES: you export your Outlook Inbox (.pst) and drop it here.
 * It's read in your browser (pstWorker), matched against your customers
 * (mailMatch), and only what's found is saved: replies on the timeline (the
 * follow-ups stop and they show under Needs a reply), bounces (address
 * marked bad, follow-ups stopped), out-of-office notes.
 */
export interface ScanSummary {
  read: number;
  found: (Found & { name: string })[];
}

function readPst(file: File, req: Omit<PstRequest, 'file'>, onProgress: (read: number) => void): Promise<{ mails: Mail[]; total: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pstWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<PstReply>) => {
      if (e.data.type === 'progress') onProgress(e.data.read);
      else {
        w.terminate();
        if (e.data.type === 'done') resolve({ mails: e.data.mails, total: e.data.total });
        else reject(new Error(e.data.error));
      }
    };
    w.onerror = (e) => (w.terminate(), reject(new Error(e.message || 'Could not read the file.')));
    w.postMessage({ file, ...req } satisfies PstRequest);
  });
}

export async function scanInbox(file: File, onProgress: (read: number) => void): Promise<ScanSummary> {
  if (!/\.(pst|ost)$/i.test(file.name)) throw new Error("That isn't an Outlook data file. Export your Inbox as a .pst (Outlook: File → Open and export → Import/Export).");
  const customers = Object.values(await getCustomers()).filter((c) => c.email.trim());
  if (!customers.length) throw new Error('No customers with an email address yet.');
  const since = customers.map((c) => c.createdAt).sort()[0];
  const emails = customers.map((c) => c.email.trim().toLowerCase());
  const domains = [...new Set(emails.map(businessDomain).filter(Boolean))];
  const { mails, total } = await readPst(file, { since, emails, domains }, onProgress);
  const found = findReplies(mails, customers);
  const byId = new Map(customers.map((c) => [c.id, c]));
  for (const f of found) {
    await logActivity(f.customerId, foundActivity(f));
    if (f.kind === 'bounce') await updateCustomer(f.customerId, (c: Customer) => ({ emailBounced: true, ...stopSequence(c, 'Email bounced') }));
  }
  return { read: total, found: found.map((f) => ({ ...f, name: nameOf(byId.get(f.customerId)) })) };
}

const nameOf = (c: Customer | undefined) => (c ? `${c.firstName} ${c.lastName}`.trim() || c.company || c.email : '');
