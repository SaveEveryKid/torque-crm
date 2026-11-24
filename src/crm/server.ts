import { TwilioDialerProvider } from '../core/dialer/twilioProvider';

/**
 * What's set up on Cloudflare, and the dialer through Torque CRM's server:
 * the browser never has the dialer password (it's a Cloudflare secret that
 * /api/dialer adds to each request).
 */
interface Status {
  dialer: boolean;
  dialerUrl: string | null;
  sms: { ready: boolean; from: string | null; incomingUrl: string | null; missing?: string[]; via?: 'kenect' | 'dialer' | 'signalwire' };
}
let status: Status = { dialer: false, dialerUrl: null, sms: { ready: false, from: null, incomingUrl: null } };

export async function loadStatus(): Promise<void> {
  const res = await fetch('/api/status', { credentials: 'same-origin' });
  if (res.ok) status = (await res.json()) as Status;
}

export const dialerReady = () => status.dialer;
export const dialerAddress = () => status.dialerUrl;
export const smsSetup = () => status.sms ?? { ready: false, from: null, incomingUrl: null };
export const smsReady = () => Boolean(status.sms?.ready);
export const viaKenect = () => status.sms?.via === 'kenect';

/** Bring in new Kenect texts now (it also happens every 5 minutes on Cloudflare). */
export async function syncKenectNow(days?: number): Promise<{ checked: number; added: number; error?: string }> {
  const res = await fetch(`/api/kenect/sync${days ? `?days=${days}` : ''}`, { method: 'POST', credentials: 'same-origin' });
  return (await res.json().catch(() => ({ checked: 0, added: 0, error: `Sync failed (${res.status}).` }))) as { checked: number; added: number; error?: string };
}

/**
 * The Torque dialer provider, sending to /api/dialer/api and /api/dialer/draft
 * on this site. (The address below only satisfies the provider's own address
 * check; requests go to this site, and the token is replaced on Cloudflare.)
 */
const VIA = 'https://torque-crm.via.workers.dev';
export function dialerProvider(): TwilioDialerProvider {
  return new TwilioDialerProvider(VIA, 'kept-on-cloudflare', (url, init) => fetch(`/api/dialer${new URL(url).pathname}`, { ...init, credentials: 'same-origin' }));
}
