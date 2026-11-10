import { useState } from 'react';
import { composeUrl, openCompose } from '../crm/email';
import { logActivity, useSettings } from '../crm/store';
import type { Customer } from '../crm/types';
import { copy, Icon, Modal } from './kit';

/**
 * EMAIL A CUSTOMER: write it here, then Open in Outlook. The email goes on
 * their timeline (like eLead) the moment it opens in Outlook, with the
 * subject and the whole message; you press Send in Outlook.
 */
export function EmailComposer({ customer: c, initial, onClose }: { customer: Customer; initial?: { subject: string; body: string }; onClose: () => void }) {
  const settings = useSettings();
  const greeting = c.firstName ? `Hi ${c.firstName},\n\n` : c.company ? 'Hello,\n\n' : '';
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? greeting);
  const [error, setError] = useState<string | null>(null);
  const long = settings.emailApp === 'outlook-web' && composeUrl({ to: c.email, subject, body }, 'outlook-web').length >= 2000;

  const send = async (open: boolean) => {
    if (!body.trim() || body.trim() === greeting.trim()) return setError('Write the email first.');
    await logEmail(c, subject, body);
    if (open) openCompose({ to: c.email, subject, body }, settings);
    onClose();
  };

  return (
    <Modal
      wide
      title={`Email ${`${c.firstName} ${c.lastName}`.trim() || c.company || c.email}`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => void send(false)} title="Already sent it some other way: just put it on the timeline">
            <Icon name="check" size={16} /> Log only
          </button>
          <button className="btn primary" onClick={() => void send(true)}>
            <Icon name="mail" size={16} /> Open in Outlook
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          To
          <input value={c.email} readOnly />
        </label>
        <label className="field">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus={!initial} />
        </label>
        <label className="field">
          Message
          <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!initial} />
        </label>
        {long && (
          <p className="notice">
            This one is long for Outlook on the web, so the end may be cut off there.{' '}
            <button className="link small" onClick={() => void copy(body)}>
              Copy the whole message
            </button>{' '}
            and paste it in.
          </p>
        )}
        <p className="muted small">
          Opening it in Outlook saves this email to {c.firstName || 'their'} timeline. Outlook adds your signature. Change where emails open in Settings → Email.
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

/** Put a sent email on the customer's timeline (Claude reads the timeline before every draft). */
export async function logEmail(c: Customer, subject: string, body: string) {
  const at = new Date().toISOString();
  await logActivity(c.id, { at, channel: 'EMAIL', direction: 'OUTBOUND', outcome: subject.trim() ? `Subject: ${subject.trim()}` : null, text: body.trim() });
}
