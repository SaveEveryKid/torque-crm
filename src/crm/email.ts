import type { Settings } from './types';

/**
 * EMAIL IN OUTLOOK: the Email buttons open a new message to the customer,
 * subject and body filled in, in Outlook. Either the Outlook app on this
 * computer (through mailto:, when Outlook is your default email app) or
 * Outlook on the web (your work Microsoft 365 account). You send it from
 * Outlook yourself; nothing is sent from here.
 */
export interface Compose {
  to: string;
  subject?: string;
  body?: string;
}

/** Outlook on the web caps a link around 2,000 characters; long bodies are cut there (copy the rest). */
const MAX_URL = 2000;

export function composeUrl(m: Compose, app: Settings['emailApp']): string {
  const to = m.to.trim();
  if (app === 'outlook-web') {
    const q = new URLSearchParams({ to });
    if (m.subject) q.set('subject', m.subject);
    if (m.body) q.set('body', m.body);
    let url = `https://outlook.office.com/mail/deeplink/compose?${q.toString().replace(/\+/g, '%20')}`;
    if (url.length > MAX_URL && m.body) {
      q.set('body', m.body.slice(0, Math.max(0, m.body.length - (url.length - MAX_URL) - 20)) + '…');
      url = `https://outlook.office.com/mail/deeplink/compose?${q.toString().replace(/\+/g, '%20')}`;
    }
    return url;
  }
  const q = [m.subject && `subject=${encodeURIComponent(m.subject)}`, m.body && `body=${encodeURIComponent(m.body.replace(/\r?\n/g, '\r\n'))}`].filter(Boolean).join('&');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}${q ? `?${q}` : ''}`;
}

/** Open the new message: Outlook on the web in a new tab, the Outlook app through mailto:. */
export function openCompose(m: Compose, s: Pick<Settings, 'emailApp'>): void {
  const url = composeUrl(m, s.emailApp);
  if (s.emailApp === 'outlook-web') window.open(url, '_blank', 'noopener');
  else location.href = url;
}
