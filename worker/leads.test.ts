import { describe, expect, it } from 'vitest';
import { alertText, checkSignature, readLead } from './leads';

async function signFor(secret: string, ts: string, body: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What RideWithByron.com sends (its docs/TORQUE-INTEGRATION.md). */
const payload = {
  event: 'lead.created',
  idempotency_key: 'rwb-lead-123',
  occurred_at: '2026-11-12T15:00:00.000Z',
  contact: { name: 'Pat Rider', phone: '+12565552964', phone_display: '(256) 555-2964', email: 'PAT@Example.com' },
  inquiry: { type: 'quote', label: 'Get My Best Quote', message: 'Do you take trades?', preferred_time: null },
  vehicle: { description: '2026 Polaris Ranger Crew XP 1000', stock_number: 'R12345', url: 'https://www.ridewithbyron.com/inventory/x', source_guid: 'abc-guid' },
  attribution: { source: 'Google Ads', utm_campaign: 'rangers-nov' },
};

describe('website leads: the signed request', () => {
  const now = 1_794_500_000_000;
  const ts = String(now / 1000);
  const body = JSON.stringify(payload);

  it('accepts a request signed with the shared secret', async () => {
    expect(await checkSignature('s3cret', ts, await signFor('s3cret', ts, body), body, now)).toBeNull();
  });

  it('rejects a wrong secret, a changed body, an old request and a missing timestamp', async () => {
    const good = await signFor('s3cret', ts, body);
    expect(await checkSignature('s3cret', ts, await signFor('other', ts, body), body, now)).toBe('Bad signature.');
    expect(await checkSignature('s3cret', ts, good, body.replace('Pat', 'Pam'), now)).toBe('Bad signature.');
    expect(await checkSignature('s3cret', ts, good, body, now + 6 * 60_000)).toBe('Request is too old.');
    expect(await checkSignature('s3cret', '', good, body, now)).toBe('Missing timestamp.');
    expect(await checkSignature('s3cret', ts, '', body, now)).toBe('Bad signature.');
  });
});

describe('website leads: reading the payload', () => {
  it('keeps what Torque needs, tidied', () => {
    expect(readLead(payload)).toEqual({
      id: 'rwb-lead-123',
      at: '2026-11-12T15:00:00.000Z',
      name: 'Pat Rider',
      phone: '+12565552964',
      email: 'pat@example.com',
      type: 'quote',
      label: 'Get My Best Quote',
      message: 'Do you take trades?',
      preferredTime: '',
      vehicle: { id: 'abc-guid', title: '2026 Polaris Ranger Crew XP 1000', stock: 'R12345', url: 'https://www.ridewithbyron.com/inventory/x' },
      source: 'Google Ads',
      campaign: 'rangers-nov',
    });
  });

  it('a general inquiry has no vehicle; a link that is not https is dropped', () => {
    expect(readLead({ ...payload, vehicle: null })?.vehicle).toBeNull();
    expect(readLead({ ...payload, vehicle: { ...payload.vehicle, url: 'javascript:alert(1)' } })?.vehicle?.url).toBeNull();
  });

  it('refuses a lead with no name, no real phone number or no id', () => {
    expect(readLead({ ...payload, contact: { ...payload.contact, name: '' } })).toBeNull();
    expect(readLead({ ...payload, contact: { ...payload.contact, phone: '555-2964' } })).toBeNull();
    expect(readLead({ ...payload, idempotency_key: '' })).toBeNull();
    expect(readLead('nonsense')).toBeNull();
    expect(readLead(null)).toBeNull();
  });

  it('never lets odd characters into the row key, and caps long text', () => {
    expect(readLead({ ...payload, idempotency_key: '../customers/x' })?.id).toBe('customersx');
    expect(readLead({ ...payload, inquiry: { ...payload.inquiry, message: 'x'.repeat(5000) } })?.message.length).toBe(1500);
  });
});

describe('website leads: the text to your own phone', () => {
  it('says who, their number, what they want and the unit', () => {
    expect(alertText(readLead(payload)!)).toBe('New website lead: Pat Rider (256) 555-2964. Get My Best Quote: 2026 Polaris Ranger Crew XP 1000 (#R12345). "Do you take trades?"');
  });
  it('stays short for a long message and mentions a visit time', () => {
    const t = alertText(readLead({ ...payload, vehicle: null, inquiry: { type: 'visit', label: 'Schedule a Visit', message: 'x'.repeat(900), preferred_time: 'Saturday morning' } })!);
    expect(t.length).toBeLessThanOrEqual(480);
    expect(t).toContain('Schedule a Visit.');
    expect(t).toContain('Wants to come in: Saturday morning.');
  });
});
