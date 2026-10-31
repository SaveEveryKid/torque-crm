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
