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

  it('the ad lists each accessory at your price plus labor (labor never mentioned), GPS at no charge, and the total as equipped', () => {
    const list: UnitAccessory[] = [
      { key: 'w', part: '1000001', description: 'DEMO WINCH', price: 700, labor: 287.5 },
      { key: 'g', part: 'PASSTIMEGPS', description: 'PASSTIME GPS', price: 0, labor: 0, free: true },
    ];
    expect(installed(list[0])).toBe(987.5);
    const block = accessoryBlock(list, 11999);
    expect(block).toBe(
      'Equipped with:\n• DEMO WINCH – $987.50\n• PASSTIME GPS – included at no charge\nTotal price as equipped: $12,986.50 (unit $11,999 + accessories $987.50)',
    );
    expect(block.toLowerCase()).not.toContain('labor');
    expect(accessoryBlock([list[1]], 11999)).toBe('Equipped with:\n• PASSTIME GPS – included at no charge\nTotal price as equipped: $11,999');
    expect(accessoryBlock([], 11999)).toBe('');
  });

  it('goes into the listing description (and is left out cleanly when there are none)', () => {
    const template = 'Payments as low as {payment} (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\n{accessories}\n\nOptional accessories not included in pricing...message for more details.';
    expect(describeListing(template, 100, 'Equipped with:\n• DEMO WINCH – $987.50')).toBe(
      'Payments as low as $100/mo (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\nEquipped with:\n• DEMO WINCH – $987.50\n\nOptional accessories not included in pricing...message for more details.',
    );
    expect(describeListing(template, 100, '')).toBe('Payments as low as $100/mo (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\nOptional accessories not included in pricing...message for more details.');
  });

  it('cleans install notes off the ad wording', () => {
    expect(adDescription('HD 3500 WINCH - NEEDS BUS BAR')).toBe('HD 3500 WINCH');
    expect(adDescription('BUS BAR - ONLY BASE MODEL')).toBe('BUS BAR');
    expect(adDescription('HD EXTR KICK OUT (2)')).toBe('HD EXTR KICK OUT (2)');
  });
});
