/// <reference lib="webworker" />
import { Buffer } from 'buffer';
import type { Mail } from './mailMatch';
import { extractMails } from './pstExtract';

/**
 * Reads an exported Outlook Inbox (.pst) here in your browser, off the main
 * thread. Only emails newer than `since` from the given addresses or domains
 * (plus bounces) are sent back; the file never leaves your computer.
 */
export interface PstRequest {
  file: File;
  since: string;
  emails: string[];
  domains: string[];
}
export type PstReply = { type: 'progress'; read: number } | { type: 'done'; mails: Mail[]; total: number } | { type: 'error'; error: string };

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

const post = (m: PstReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<PstRequest>) => {
  try {
    const { PSTFile } = await import('pst-extractor');
    const { file, since, emails, domains } = e.data;
    const pst = new PSTFile(Buffer.from(await file.arrayBuffer()) as never);
    const { mails, total } = extractMails(pst.getRootFolder() as never, { since, emails: new Set(emails), domains: new Set(domains), onProgress: (read) => post({ type: 'progress', read }) });
    post({ type: 'done', mails, total });
  } catch (err) {
    post({ type: 'error', error: /BDN|header/i.test(String(err)) ? "That isn't an Outlook data file (.pst). Export your Inbox from Outlook: File → Open and export → Import/Export → Export to Outlook Data File (.pst)." : String((err as Error).message ?? err) });
  }
};
