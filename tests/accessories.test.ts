import { describe, expect, it } from 'vitest';
import { accessoryBlock, adDescription, choiceLabel, choices, installed, readCatalog, type UnitAccessory } from '../src/crm/accessories';
import { describe as describeListing } from '../src/crm/lister';

// A made-up labor list in the same shape as the real one (the real one stays in your Torque database).
const CSV = `part_number,accessory_description,labor_hours,labor_cost_usd,hourly_rate_usd,cost_source,vehicle_sections,package_tiers
1000001,DEMO WINCH - NEEDS BUS BAR,2.5,287.5,115,printed,01,BEST
1000002,DEMO LIGHT BAR,1.5,172.5,115,printed,05;06,BEST
1000002,DEMO LIGHT BAR,2,230,115,printed,07,BEST
1000002,DEMO LIGHT BAR,2,230,115,printed,08,BEST
,DEMO SPEAKER KIT,,,115,missing_hours,07,BEST
,DEMO DOORS,3,,115,computed,03,BEST
,STAGE 1 - UNSPECIFIED ACCESSORY,1,115,115,printed,06,BEST
`;

describe('accessories', () => {
  const r = readCatalog(CSV);
  if ('error' in r) throw new Error(r.error);
  const by = (part: string, labor: number) => r.items.find((i) => i.part === part && i.labor === labor)!;

  it('reads the labor list: one choice per part and labor charge, "unspecified" rows left out', () => {
    expect(r.items).toHaveLength(5);
    expect(r.skipped).toEqual(['STAGE 1 - UNSPECIFIED ACCESSORY']);
    expect(by('1000001', 287.5).description).toBe('DEMO WINCH');
    // Hours but no cost: hours × rate. Nothing at all: no labor.
    expect(r.items.find((i) => i.listed === 'DEMO DOORS')!.labor).toBe(345);
    expect(r.items.find((i) => i.listed === 'DEMO SPEAKER KIT')!.labor).toBe(0);
    // Same part, same labor on two units: one choice for both.
    expect(by('1000002', 230).sections).toEqual(['07', '08']);
  });

  it('the dropdown says which unit each labor charge is for when a part has more than one', () => {
    const all = choices(r.items);
    expect(all[0].part).toBe('PASSTIMEGPS');
    expect(choiceLabel(all[0], all)).toBe('PASSTIMEGPS — PassTime GPS (no charge)');
    expect(choiceLabel(by('1000002', 172.5), all)).toBe('1000002 — DEMO LIGHT BAR (for section 05, section 06 · labor $172.50)');
    expect(choiceLabel(by('1000002', 230), all)).toBe('1000002 — DEMO LIGHT BAR (for section 07, section 08 · labor $230.00)');
    expect(choiceLabel(by('1000001', 287.5), all)).toBe('1000001 — DEMO WINCH - NEEDS BUS BAR');
  });

  it('the ad names each accessory (no price per item, labor never mentioned, GPS not mentioned), then the total as equipped', () => {
    const list: UnitAccessory[] = [
      { key: 'r', part: '1000003', description: 'DEMO RACK EXTENDER', price: 149.99, labor: 34.5 },
      { key: 'w', part: '1000001', description: 'DEMO WINCH', price: 700, labor: 287.5 },
      { key: 'g', part: 'PASSTIMEGPS', description: 'PASSTIME GPS', price: 0, labor: 0, free: true },
    ];
    expect(installed(list[1])).toBe(987.5);
    const block = accessoryBlock(list, 5699);
    expect(block).toBe(
      'Equipped with:\n\n• DEMO RACK EXTENDER\n• DEMO WINCH\n\n💰 Base unit: $5,699\n\n💰 Accessories: $1,171.99\n\nTotal equipped price: $6,870.99',
    );
    expect(block.toLowerCase()).not.toMatch(/labor|gps|no charge/);
    // Only GPS on the unit: nothing to list.
    expect(accessoryBlock([list[2]], 11999)).toBe('');
    // Typed in by hand: anything named GPS / PassTime stays out of the ad and the total.
    const typed: UnitAccessory[] = [
      { key: 'a', part: '', description: 'Ranger Roof', price: 400, labor: 57.5 },
      { key: 'b', part: '', description: 'PassTime GPS', price: 0, labor: 0 },
    ];
    expect(accessoryBlock(typed, 13999)).toBe('Equipped with:\n\n• Ranger Roof\n\n💰 Base unit: $13,999\n\n💰 Accessories: $457.50\n\nTotal equipped price: $14,456.50');
    expect(accessoryBlock([], 11999)).toBe('');
  });

  it('goes into the listing description (and is left out cleanly when there are none)', () => {
    const template = 'Payments as low as {payment} (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\n{accessories}\n\nOptional accessories not included in pricing...message for more details.';
    // ("Optional accessories not included in pricing…" is dropped, even from an older template.)
    expect(describeListing(template, 100, 'Equipped with:\n• DEMO WINCH – $987.50')).toBe('Payments as low as $100/mo (WAC)\n✅️ NO DEALER FEES! ✅️\n\n\nEquipped with:\n• DEMO WINCH – $987.50\n');
    expect(describeListing(template, 100, '')).toBe('Payments as low as $100/mo (WAC)\n✅️ NO DEALER FEES! ✅️\n\n');
    expect(describeListing(template + '\n\nShoals', 100, '')).not.toMatch(/optional accessories/i);
  });

  it('the dropdown is in part-number order (numbers as numbers), entries with no part number last', () => {
    const items = [
      { part: 'TSK-1908', listed: 'X' },
      { part: '', listed: 'A KIT' },
      { part: '2876958', listed: 'Y' },
      { part: '630-0054', listed: 'Z' },
      { part: '32100', listed: 'W' },
      { part: '', listed: '26-INCH TIRE' },
      { part: '2884648', listed: 'L', labor: 230, sections: ['07'] },
      { part: '2884648', listed: 'L', labor: 172.5, sections: ['05'] },
    ].map((i, k) => ({ key: String(k), description: i.listed, labor: 0, ...i }));
    expect(choices(items).map((c) => c.part || c.listed)).toEqual(['PASSTIMEGPS', '630-0054', '32100', '2876958', '2884648', '2884648', 'TSK-1908', '26-INCH TIRE', 'A KIT']);
    expect(choices(items).filter((c) => c.part === '2884648').map((c) => c.sections![0])).toEqual(['05', '07']);
  });

  it('cleans install notes off the ad wording', () => {
    expect(adDescription('HD 3500 WINCH - NEEDS BUS BAR')).toBe('HD 3500 WINCH');
    expect(adDescription('BUS BAR - ONLY BASE MODEL')).toBe('BUS BAR');
    expect(adDescription('HD EXTR KICK OUT (2)')).toBe('HD EXTR KICK OUT (2)');
  });
});

describe('listing description is written by Torque', async () => {
  const { describe: d, olderThan } = await import('../src/crm/lister');
  it('puts the accessories and total in even when the extension is older (its template has no spot for them)', () => {
    const oldTemplate = 'Payments as low as {payment} (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\nOptional accessories not included in pricing...message for more details.\n\nShoals Outdoor Sports- Florence, AL';
    expect(d(oldTemplate, 100, 'Equipped with:\n• DEMO – $10\nTotal price as equipped: $5,709')).toBe(
      'Payments as low as $100/mo (WAC)\n✅️ NO DEALER FEES! ✅️\n\n\nEquipped with:\n• DEMO – $10\nTotal price as equipped: $5,709\n\nShoals Outdoor Sports- Florence, AL',
    );
    expect(d('Hello', null, 'Equipped with:\n• DEMO – $10')).toBe('Hello\nEquipped with:\n• DEMO – $10\n');
  });
  it('knows an out-of-date extension', () => {
    expect(olderThan('0.5.4', '0.9.0')).toBe(true);
    expect(olderThan('0.9.0', '0.9.0')).toBe(false);
    expect(olderThan('0.10.0', '0.9.0')).toBe(false);
    expect(olderThan(undefined, '0.9.0')).toBe(true);
  });
});

describe('the Marketplace description (written by Torque)', async () => {
  const { listingDescription } = await import('../src/crm/lister');
  const { accessoryBlock: block } = await import('../src/crm/accessories');
  it("matches Byron's example (the Ranger 150 EFI), website kept at the bottom", () => {
    const acc = block([{ key: 'k', part: '', description: 'Roof, windshield and back panel kit', price: 534.99, labor: 0 }], 5999);
    expect(
      listingDescription(119, acc, 'Byron Green', 'A youth side-by-side built for family off-road adventures! A great option for younger riders learning the ropes under adult supervision.'),
    ).toBe(
      [
        'A youth side-by-side built for family off-road adventures! A great option for younger riders learning the ropes under adult supervision.',
        '✅ NO DEALER FEES!',
        'Equipped with:',
        '• Roof, windshield and back panel kit',
        '💰 Base unit: $5,999',
        '💰 Accessories: $534.99',
        'Total equipped price: $6,533.99',
        'Payments as low as $119/mo (WAC; ask for financing terms).',
        '⏳ Message me with any questions or to set up a time to see this unit!',
        '‼️ Ask for Byron Green ‼️',
        'Shoals Outdoor Sports',
        '3516 Florence Blvd, Florence, AL 35634',
        '🌐 shoalsoutdoorsports dot com',
      ].join('\n\n'),
    );
  });
  it('leaves out what a unit does not have (no blurb, accessories or payment)', () => {
    expect(listingDescription(null, '', 'Byron Green')).toBe(
      '✅ NO DEALER FEES!\n\n⏳ Message me with any questions or to set up a time to see this unit!\n\n‼️ Ask for Byron Green ‼️\n\nShoals Outdoor Sports\n\n3516 Florence Blvd, Florence, AL 35634\n\n🌐 shoalsoutdoorsports dot com',
    );
  });
});

describe('the short product blurb', async () => {
  const { cleanBlurb } = await import('../src/crm/blurb');
  it('keeps one or two short sentences; refuses prices, links, phone numbers and rambling', () => {
    expect(cleanBlurb('"A youth side-by-side built for family off-road adventures! A great option for younger riders."')).toBe(
      'A youth side-by-side built for family off-road adventures! A great option for younger riders.',
    );
    expect(cleanBlurb('Only $5,999 today!')).toBeNull();
    expect(cleanBlurb('See shoalsoutdoorsports.com for more.')).toBeNull();
    expect(cleanBlurb('Call 256-762-0959.')).toBeNull();
    expect(cleanBlurb('One. Two. Three.')).toBeNull();
    expect(cleanBlurb('x'.repeat(300))).toBeNull();
    expect(cleanBlurb(42)).toBeNull();
  });
});

describe('writing the blurb through the dialer', async () => {
  const { writeBlurb } = await import('../src/crm/blurb');
  const ai = await import('../src/crm/ai');
  it('reads the description from "text" (the shape the dialer answers in) and retries once when it does not fit', async () => {
    const answers = [{ skip: false, skipReason: '', text: 'Only $5,999!', emailSubject: '', emailBody: '', why: 'x' }, { skip: false, skipReason: '', text: 'A youth side-by-side for family adventures.', emailSubject: '', emailBody: '', why: 'x' }];
    const asked: string[] = [];
    const spy = (await import('vitest')).vi.spyOn(ai, 'completeFor').mockReturnValue(async (m) => (asked.push(m[1].content), answers.shift()));
    const unit = { id: 'u', title: '2026 Polaris Ranger 150 EFI', condition: 'New', type: 'Youth', raw: { LongDescription: '<p>Built for young riders.</p>' } } as never;
    expect(await writeBlurb(unit, {} as never)).toBe('A youth side-by-side for family adventures.');
    expect(asked[0]).toContain("Maker's description: Built for young riders.");
    expect(asked[1]).toContain("didn't fit");
    spy.mockRestore();
  });
});
