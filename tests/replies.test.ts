import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PSTFile } from 'pst-extractor';
import { findReplies, foundActivity, mailActivityId, type Mail } from '../src/crm/mailMatch';
import { extractMails } from '../src/crm/pstExtract';
import { afterActivity, running } from '../src/crm/sequence';
import { activity, blankCustomer } from '../src/crm/store';
import type { Customer } from '../src/crm/types';

const SAMPLE = 'node_modules/pst-extractor/example/testdata/enron.pst';

describe('reading an exported Outlook Inbox (.pst)', () => {
  it.skipIf(!existsSync(SAMPLE))('keeps only emails from customers (and their companies) and bounces, newer than the cutoff', () => {
    const pst = new PSTFile(readFileSync(SAMPLE));
    const { mails, total } = extractMails(pst.getRootFolder() as never, { since: '2000-01-01', emails: new Set(['jreames@br-inc.com']), domains: new Set(['pplweb.com']) });
    expect(total).toBeGreaterThan(50);
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.length).toBeLessThan(total);
    expect(mails.every((m) => m.from === 'jreames@br-inc.com' || m.from.endsWith('@pplweb.com') || m.report)).toBe(true);
    const julie = mails.find((m) => m.from === 'jreames@br-inc.com')!;
    expect(julie).toMatchObject({ subject: 'I/B Link Capacity for November and December 2001', fromName: 'Reames Julie' });
    expect(julie.text).toMatch(/Burlington Resources/);
    expect(julie.id).toMatch(/^</);
    expect(extractMails(new PSTFile(readFileSync(SAMPLE)).getRootFolder() as never, { since: '2030-01-01', emails: new Set(['jreames@br-inc.com']), domains: new Set() }).mails).toEqual([]);
  });
});

describe('matching replies to customers', () => {
  const sent = activity({ at: '2026-11-02T15:00:00Z', channel: 'EMAIL', direction: 'OUTBOUND', outcome: 'Subject: Polaris UTVs', text: 'Hello…' });
  const base = { createdAt: '2026-11-01T00:00:00Z' };
  const ava = blankCustomer({ ...base, firstName: 'Ava', company: 'Riverbend Paving', email: 'ava@riverbend.example', activities: [sent] });
  const beth = blankCustomer({ ...base, firstName: 'Beth', company: 'Riverbend Paving', email: 'beth@riverbend.example' });
  const gmail = blankCustomer({ ...base, firstName: 'Zach', email: 'zach@gmail.com', activities: [sent] });
  const quiet = blankCustomer({ ...base, company: 'Summit', email: 'office@summit.example' });
  const all = [ava, beth, gmail, quiet];
  const mail = (p: Partial<Mail>): Mail => ({ id: `<${Math.random()}@x>`, subject: 'Re: Polaris UTVs', from: '', fromName: '', at: '2026-11-03T14:00:00Z', text: 'Thanks', ...p });

  it('their own address, or a coworker at a company you emailed; never webmail strangers or old mail', () => {
    const found = findReplies(
      [
        mail({ from: 'ava@riverbend.example', text: 'Send me a quote for two.' }),
        mail({ from: 'jim@riverbend.example', fromName: 'Jim Fleet', text: 'I handle purchasing.' }),
        mail({ from: 'stranger@gmail.com' }),
        mail({ from: 'office@summit.example', at: '2026-10-01T00:00:00Z' }),
        mail({ from: 'nobody@polaris.com' }),
      ],
      all,
    );
    expect(found.map((f) => [f.customerId, f.kind, !!f.viaDomain])).toEqual([
      [ava.id, 'reply', false],
      [ava.id, 'reply', true],
    ]);
    expect(foundActivity(found[1]).outcome).toBe('Subject: Re: Polaris UTVs · from Jim Fleet <jim@riverbend.example>');
  });

  it('out-of-office is noted but is not a reply; a bounce names the dead address', () => {
    const found = findReplies(
      [
        mail({ from: 'ava@riverbend.example', subject: 'Automatic reply: Polaris UTVs', text: 'Out until Monday.' }),
        mail({ from: 'postmaster@outlook.com', subject: 'Undeliverable: Polaris UTVs', text: "Your message to zach@gmail.com couldn't be delivered.", report: true }),
      ],
      all,
    );
    expect(found.map((f) => [f.customerId, f.kind])).toEqual([
      [ava.id, 'auto'],
      [gmail.id, 'bounce'],
    ]);
    expect(foundActivity(found[0]).direction).toBe('INTERNAL');
  });

  it('scanning the same export again finds nothing new', () => {
    const m = mail({ from: 'ava@riverbend.example' });
    const [f] = findReplies([m], all);
    const after: Customer = { ...ava, activities: [foundActivity(f), ...ava.activities] };
    expect(findReplies([m], [after, beth, gmail, quiet])).toEqual([]);
    expect(foundActivity(f).id).toBe(mailActivityId(m.id));
  });

  it('a found reply stops the follow-ups and asks you to answer', () => {
    let c: Customer = { ...ava, ...afterActivity({ ...ava, activities: [] }, sent) };
    expect(running(c)).toBe(true);
    const [f] = findReplies([mail({ from: 'ava@riverbend.example' })], [c]);
    c = { ...c, ...afterActivity(c, foundActivity(f)) };
    expect(running(c)).toBe(false);
    expect(c.tasks.some((t) => t.reply && !t.done)).toBe(true);
  });
});
