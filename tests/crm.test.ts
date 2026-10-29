import { describe, expect, it } from 'vitest';
import { kv } from '../src/core/storage/kv';
import { addCustomer, blankCustomer, getCustomers, logActivity, saveSettings } from '../src/crm/store';
import { fromRecord, importCsv, toRecord } from '../src/crm/record';
import { parseSearchConfig, readUnit, usefulFacets } from '../src/crm/inventory';
import { backupJson, restoreBackup } from '../src/crm/backup';
import { packRecord } from '../src/core/analysis/customExport';
import { draftFollowUp, type FollowUpDraft } from '../src/core/ai/followUp';
import type { ChatMessage } from '../src/core/ai/localEngine';

const NOW = new Date('2026-10-28T15:00:00');

describe('customers and the AI record', () => {
  it('logs activity newest first, and the first outbound contact moves New to Contacted', async () => {
    const c = await addCustomer(blankCustomer({ firstName: 'Pat', lastName: 'Sample', phone: '256.555.2964' }));
    expect(c.phone).toBe('(256) 555-2964');
    await logActivity(c.id, { channel: 'TEXT', direction: 'INBOUND', outcome: null, text: 'Is the green one still there?', at: '2026-10-27T10:00:00.000Z' });
    await logActivity(c.id, { channel: 'TEXT', direction: 'OUTBOUND', outcome: null, text: 'It is! Want to see it Saturday?', at: '2026-10-27T11:00:00.000Z' });
    const saved = (await getCustomers())[c.id];
    expect(saved.stage).toBe('contacted');
    expect(saved.activities.map((a) => a.direction)).toEqual(['OUTBOUND', 'INBOUND']);
  });

  it("Claude gets the customer's history, with their words marked as theirs", async () => {
    const c = blankCustomer({
      firstName: 'Pat',
      lastName: 'Sample',
      phone: '(256) 555-2964',
      interest: '2025 Grizzly 700',
      notes: 'Hunts every fall',
      activities: [
        { id: '2', at: '2026-10-27T11:00:00.000Z', channel: 'TEXT', direction: 'OUTBOUND', outcome: null, text: 'Want to see it Saturday?' },
        { id: '1', at: '2026-10-27T10:00:00.000Z', channel: 'TEXT', direction: 'INBOUND', outcome: null, text: 'Is the green one still there?' },
      ],
    });
    const r = toRecord(c, 'Byron Green');
    expect(r.customer.firstName).toBe('Pat');
    expect(r.opportunity.vehicle).toBe('2025 Grizzly 700');
    const seen: ChatMessage[][] = [];
    const draft: FollowUpDraft = { skip: false, skipReason: null, text: 'Pat, the green Grizzly is still here. Does Saturday at 10 work to ride it?', emailSubject: 'The green Grizzly', emailBody: 'Pat,\n\nIt is still here. Does Saturday at 10 work?', why: 'x' };
    await draftFollowUp(r, { name: 'Byron Green', dealership: 'Shoals Outdoor Sports', phone: '' }, async (m) => (seen.push(m), draft), NOW);
    const prompt = seen[0][1].content;
    expect(prompt).toMatch(/Is the green one still there\?/);
    expect(prompt).toMatch(/Hunts every fall/);
    expect(seen[0][0].content).not.toMatch(/eLead/);
  });
});

describe('import', () => {
  it('imports a plain CSV and a Torque list backup with eLead history, skipping phones already here', () => {
    const rec = toRecord(
      blankCustomer({ firstName: 'Chris', lastName: 'Sample', phone: '(256) 555-2199', activities: [{ id: 'a', at: '2026-10-01T10:00:00.000Z', channel: 'TEXT', direction: 'INBOUND', outcome: null, text: 'call me friday' }] }),
      'Byron Green',
    );
    const csv = `Customer,Phone,Vehicle,Notes,Torque Data\nPat Sample,(205) 555-2142,Camry,likes red,\nChris Sample,256-555-2199,,,"${packRecord(rec).replace(/"/g, '""')}"\nDupe,256-555-2964,,,\n`;
    const existing = [blankCustomer({ phone: '(256) 555-2964' })];
    const res = importCsv(csv, 'list.csv', existing);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.customers.map((c) => `${c.firstName} ${c.lastName}`)).toEqual(['Pat Sample', 'Chris Sample']);
    expect(res.duplicates).toBe(1);
    expect(res.withHistory).toBe(1);
    expect(res.customers[1].activities[0]).toMatchObject({ direction: 'INBOUND', text: 'call me friday', imported: true });
    expect(fromRecord(rec).firstName).toBe('Chris');
  });
});

describe('inventory', () => {
  const page = (key: string) =>
    `<html><script type="application/json" class="showroom-search--config">{"appId":"APP1","apiKey":"${key}","defaultIndexName":"prod_X","sortingIndexes":[{"indexName":"prod_X","label":"Most Relevant","value":"a"},{"indexName":"prod_X_Price_Asc","label":"Price Lowest","value":"b"}],"url":"https://dealer.example/Inventory"}</script></html>`;

  it("reads the site's search setup and when its key expires", () => {
    const cfg = parseSearchConfig(page(btoa('hmac123restrictIndices=prod_X&validUntil=1793226103')));
    expect(cfg).toMatchObject({ appId: 'APP1', index: 'prod_X', validUntil: 1793226103 });
    expect(cfg.sorts.map((s) => s.label)).toEqual(['Most Relevant', 'Price Lowest']);
    expect(() => parseSearchConfig('<html></html>')).toThrow(/Couldn't find/);
  });

  it('reads a unit whatever the field names are, and keeps only useful filters', () => {
    const u = readUnit({ objectID: '9', Year: 2025, Manufacturer: 'Yamaha', ProductName: 'Grizzly 700 EPS', SalePrice: '11,499', MSRP: 12999, StockNumber: 'Y123', Images: [{ Url: '/img/1.jpg' }], DetailUrl: '/Inventory/x' });
    expect(u).toMatchObject({ title: '2025 Yamaha Grizzly 700 EPS', price: 11499, msrp: 12999, stock: 'Y123', image: 'https://www.shoalsoutdoorsports.com/img/1.jpg' });
    expect(readUnit({ objectID: '1' }).price).toBeNull();
    const f = usefulFacets({ Condition: { New: 40, Used: 9 }, Manufacturer: { Yamaha: 20, 'Can-Am': 8 }, OrganizationId: { a: 49 }, Year: { '2024': 1 } });
    expect(f.map((x) => x.label)).toEqual(['Condition', 'Make']);
  });
});

describe('backup', () => {
  it('restores what was backed up', async () => {
    await saveSettings({ name: 'Byron Green' });
    await addCustomer(blankCustomer({ firstName: 'Backed', phone: '(256) 555-2333' }));
    const text = backupJson();
    await kv.set({ customers: {} });
    expect(await restoreBackup(text)).toMatch(/Restored \d+ customers/);
    expect(Object.values(await getCustomers()).some((c) => c.firstName === 'Backed')).toBe(true);
  });

  it('a Torque extension backup brings over what Claude learned, not customers', async () => {
    const before = Object.keys(await getCustomers()).length;
    const msg = await restoreBackup(JSON.stringify({ app: 'Torque', kind: 'backup', data: { styleExamples: [{ at: 'x', kind: 'text', ai: 'a', sent: 'b' }], styleProfile: { text: 'I keep it short.' }, settings: { twilioUrl: 'https://d.x.workers.dev', twilioPassword: 'nope' } } }));
    expect(msg).toMatch(/1 writing examples/);
    expect(Object.keys(await getCustomers()).length).toBe(before);
    const s = (await kv.get('settings')).settings as Record<string, string>;
    expect(JSON.stringify(s)).not.toMatch(/nope|workers\.dev/);
  });
});

import { findPhoto } from '../src/crm/inventory';
describe('inventory photos', () => {
  it('finds the photo whatever the field is called', () => {
    expect(readUnit({ objectID: '1', Media: [{ Kind: 'photo', Location: 'https://cdn.dx1app.com/media/abc/1.jpg' }] }).image).toBe('https://cdn.dx1app.com/media/abc/1.jpg');
    expect(readUnit({ objectID: '2', Assets: { PrimaryPhotoUrl: '//cdn.example.com/u/2.webp?w=800' } }).image).toBe('https://cdn.example.com/u/2.webp?w=800');
    expect(findPhoto({ objectID: '3', DetailUrl: '/Inventory/x', Desc: 'nothing here' })).toBeNull();
    expect(readUnit({ objectID: '4', Gallery: ['https://x.com/a.png', 'https://x.com/b.png'] }).image).toBe('https://x.com/a.png');
  });
});
