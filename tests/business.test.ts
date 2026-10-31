import { describe, expect, it } from 'vitest';
import { draftFollowUp, systemPrompt } from '../src/core/ai/followUp';
import { businessSection } from '../src/core/ai/playbook';
import { suggestReply } from '../src/core/ai/replyHelper';
import { writerOf } from '../src/crm/ai';
import { toRecord } from '../src/crm/record';
import { blankCustomer } from '../src/crm/store';
import { DEFAULT_SETTINGS } from '../src/crm/types';
import type { ChatMessage } from '../src/core/ai/localEngine';

describe('commercial / fleet customers', () => {
  const person = blankCustomer({ firstName: 'Beth', lastName: 'Carter', phone: '(256) 555-2201', company: 'Riverbend Paving Co.', title: 'President' });
  const shop = blankCustomer({ phone: '(256) 555-2301', company: 'Summit Equipment Rental' });
  const retail = blankCustomer({ firstName: 'Sam', lastName: 'Hill', phone: '(256) 555-2601' });
  const answer = { skip: false, skipReason: null, text: 'Hi, this is Byron at Shoals Outdoor Sports. Who handles equipment purchases there?', emailSubject: null, emailBody: null, why: 'First contact.' };

  it('a business name switches on the commercial guidance; retail customers never get it', () => {
    expect(businessSection(writerOf(DEFAULT_SETTINGS, person))).toContain('COMMERCIAL / FLEET CUSTOMER: President at Riverbend Paving Co.');
    expect(businessSection(writerOf(DEFAULT_SETTINGS, person))).not.toContain('no contact person');
    expect(businessSection(writerOf(DEFAULT_SETTINGS, shop))).toContain("There is no contact person's name: write to the business");
    expect(businessSection(writerOf(DEFAULT_SETTINGS, retail))).toBe('');
    expect(businessSection(writerOf(DEFAULT_SETTINGS, person))).toContain('Never offer to bring a unit out, a demo');
    expect(businessSection(writerOf(DEFAULT_SETTINGS, person))).not.toMatch(/demo unit brought/);
  });

  it('it rides with the customer details, so the system prompt still fits the dialer (8,000 characters)', async () => {
    expect(systemPrompt(writerOf(DEFAULT_SETTINGS, person)).length).toBeLessThan(8000);
    let sent: ChatMessage[] = [];
    const complete = async (m: ChatMessage[]) => ((sent = m), answer);
    const w = writerOf(DEFAULT_SETTINGS, shop);
    await draftFollowUp(toRecord(shop, 'Byron Green'), w, complete, new Date('2026-10-31T15:00:00Z'), true, 'claude', '', [], businessSection(w));
    expect(sent[0].content).not.toContain('COMMERCIAL');
    expect(sent[1].content).toContain('COMMERCIAL / FLEET CUSTOMER: Summit Equipment Rental');
    await suggestReply({ thread: 'Them: send me a quote', record: toRecord(person, 'Byron Green'), writer: w, complete, context: businessSection(writerOf(DEFAULT_SETTINGS, person)) });
    expect(sent[1].content.startsWith('COMMERCIAL / FLEET CUSTOMER: President at Riverbend Paving Co.')).toBe(true);
  });

  it('the customer summary tells Claude who they are at the business', () => {
    expect(toRecord(shop, 'Byron Green').crmAiSummary).toContain("Business customer: Summit Equipment Rental (no contact person's name yet: write to the business)");
  });
});

import { checkDraft } from '../src/core/ai/followUp';
import { buildCustomerContext } from '../src/core/ai/customerContext';
describe('business drafts: quotes only, and the store is where it is', () => {
  const rule = businessSection(writerOf(DEFAULT_SETTINGS, blankCustomer({ company: 'Summit Equipment Rental' })));
  const draft = (emailBody: string) => ({ skip: false, skipReason: null, text: null, emailSubject: 'Polaris UTVs', emailBody, why: 'x' });
  const check = (body: string) => checkDraft(draft(body), { text: false, email: true }, rule, toRecord(blankCustomer({ company: 'Summit' }), 'Byron Green'));
  it('a draft that offers to bring a unit out is sent back to Claude', () => {
    const bad = "Martin, I'm Byron at Shoals Outdoor Sports. I'd like to bring a unit out so your crew can try it on the work you actually do. Who handles equipment purchases on your side?";
    expect(check(bad)).toContain('email offers to bring a unit out or a demo; the only offer is a quote');
    expect(check('Happy to set up a demo for your team.').length).toBeGreaterThan(0);
    expect(check('Could I bring a couple of RANGERs by next week?').length).toBeGreaterThan(0);
    expect(check('I can put a quote together for one unit or several. Who handles equipment purchases there?').filter((w) => /demo/.test(w))).toEqual([]);
  });
  it('the store is never called "local": the town is named instead', () => {
    const ctx = buildCustomerContext(toRecord(blankCustomer({ company: 'Metro Parks' }), 'Byron Green'), { writer: writerOf(DEFAULT_SETTINGS), today: new Date(), canText: false, sent: [] });
    const evidence = ctx.sections.map((x) => x.versions[0]).join('\n');
    const c = (body: string) => checkDraft(draft(body), { text: false, email: true }, evidence, toRecord(blankCustomer({ company: 'Metro Parks' }), 'Byron Green'));
    expect(c("Martin, I'm Byron with Shoals Outdoor Sports, a local Polaris side-by-side and ATV dealer.")).toContain('email calls the store local; name the town it\'s in instead');
    expect(c("Martin, I'm Byron with Shoals Outdoor Sports in Florence, Alabama.").filter((w) => /local/.test(w))).toEqual([]);
  });
  it('Claude is told exactly where the store is', () => {
    const ctx = buildCustomerContext(toRecord(blankCustomer({ company: 'Summit', address: 'Nashville, TN' }), 'Byron Green'), { writer: writerOf(DEFAULT_SETTINGS), today: new Date(), canText: false, sent: [] });
    expect(ctx.sections.map((s) => s.versions[0]).join('\n')).toContain('Store location: Florence, Alabama (the Shoals). Only ever say the store is here');
  });
});
