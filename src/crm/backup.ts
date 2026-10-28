import { kv } from '../core/storage/kv';
import type { Settings } from './types';

/**
 * BACKUP: everything Torque CRM keeps (customers, timeline, tasks, call log,
 * what you sent, your writing examples and profile, settings) in one file.
 * The dialer password is never put in a backup.
 */
const FORMAT = 'torque-crm-backup';

export function backupJson(now = new Date()): string {
  const data = kv.all();
  delete data.inventoryConfig;
  const s = data.settings as Partial<Settings> | undefined;
  if (s) data.settings = { ...s, dialerPassword: '' };
  return JSON.stringify({ format: FORMAT, version: 1, savedAt: now.toISOString(), data });
}

export const backupFileName = (now = new Date()) => `torque-crm-backup-${now.toISOString().slice(0, 10)}.json`;

/**
 * A backup from the Torque Chrome extension: brings over what Claude learned
 * (your edits, your "How I sell" profile), your call log and dialer settings.
 * Customers are not in those backups; import them with Customers → Import CSV.
 */
async function restoreTorqueExtension(data: Record<string, unknown>): Promise<string> {
  const patch: Record<string, unknown> = {};
  for (const k of ['styleExamples', 'styleProfile', 'callLog'] as const) if (data[k] !== undefined) patch[k] = data[k];
  const old = data.settings as Record<string, unknown> | undefined;
  if (old) {
    const current = ((await kv.get('settings')).settings as Partial<Settings> | undefined) ?? {};
    patch.settings = {
      ...current,
      ...(typeof old.twilioUrl === 'string' && old.twilioUrl ? { dialerUrl: old.twilioUrl } : {}),
      ...(typeof old.writerName === 'string' && old.writerName ? { name: old.writerName } : {}),
      ...(old.claudeQuality === 'fast' || old.claudeQuality === 'better' ? { claudeQuality: old.claudeQuality } : {}),
      ...(old.voicemail === 'connect' || old.voicemail === 'hangup' ? { voicemail: old.voicemail } : {}),
      ...(typeof old.dialDelaySeconds === 'number' ? { dialDelaySeconds: old.dialDelaySeconds } : {}),
    };
  }
  await kv.set(patch);
  const n = Array.isArray(data.styleExamples) ? data.styleExamples.length : 0;
  return `Brought over from Torque: ${n} writing examples${data.styleProfile ? ', your "How I sell" profile' : ''}${data.callLog ? ', your call log' : ''} and dialer settings. Retype the dialer password.`;
}

/** Restore a backup file: replaces what's here (your current dialer password is kept). */
export async function restoreBackup(text: string): Promise<string> {
  let parsed: { format?: string; app?: string; kind?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Torque CRM backup.");
  }
  if (parsed.app === 'Torque' && parsed.kind === 'backup' && parsed.data) return restoreTorqueExtension(parsed.data);
  if (parsed.format !== FORMAT || !parsed.data) throw new Error("That file isn't a Torque CRM backup.");
  const current = (await kv.get('settings')).settings as Partial<Settings> | undefined;
  const data = { ...parsed.data };
  if (data.settings) data.settings = { ...(data.settings as Settings), dialerPassword: current?.dialerPassword ?? '' };
  await kv.set(data);
  return `Restored ${Object.keys((data.customers as object | undefined) ?? {}).length} customers.`;
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
