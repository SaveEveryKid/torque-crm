import { describe, expect, it } from 'vitest';
import bankJson from '../src/training/bank.json';
import { readUnit, type Hit } from '../src/crm/inventory';
import { candidates, groupOf, interview, matchPrompt, readPicks, specsFor, wantedGroups } from '../src/crm/matcher';
import { DEFAULT_SETTINGS } from '../src/crm/types';
import type { Card } from '../src/training/engine';

const bank = (bankJson as { cards: Card[] }).cards;
const unit = (id: string, Year: number, Manufacturer: string, ProductName: string, ProductType: string, Price: number, extra: Partial<Hit> = {}) =>
  readUnit({ objectID: id, Year, Manufacturer, ProductName, ProductType, Price, Condition: 'New', StockNumber: id.toUpperCase(), ShowroomUrl: `https://dealer.example/${id}`, ...extra } as Hit);
const lot = [
  unit('r1', 2027, 'Polaris', 'Ranger 1000', 'Utility Vehicles', 16499),
  unit('r2', 2027, 'Polaris', 'Ranger 1000', 'Utility Vehicles', 16499),
  unit('r3', 2027, 'Polaris', 'Ranger 500', 'Utility Vehicles', 11999),
  unit('s1', 2027, 'Polaris', 'Sportsman 570', 'ATV', 8999),
  unit('b1', 2026, 'Bennington', '188 SL', 'Boat', 39999),
  unit('m1', 2026, 'Cub Cadet', 'Z2 54P', 'Mower', 5499),
];
const none = { tags: [] as string[], riders: '', budget: '' };

describe('finding the right unit', () => {
  it('the interview decides which kind of units to look at', () => {
    expect(wantedGroups({ ...none, use: 'deer hunting on 40 acres, haul feed' })).toEqual(['powersports']);
    expect(wantedGroups({ ...none, use: 'lake days with the grandkids, some tubing' })).toEqual(['water']);
    expect(wantedGroups({ ...none, use: '3 acres of yard to mow' })).toEqual(['lawn']);
    expect(groupOf(lot[4])).toBe('water');
    expect(groupOf(lot[5])).toBe('lawn');
    expect(groupOf(lot[0])).toBe('powersports');
    // The unit's own name wins over a stray category field on the listing.
    expect(groupOf({ ...lot[0], raw: { ...lot[0].raw, ProductCategory: 'Boats' } })).toBe('powersports');
  });

  it('one line per model, with how many are in stock and the key specs from the Bootcamp data', () => {
    const list = candidates(lot, { ...none, use: 'farm work' }, bank);
    expect(list).toHaveLength(3);
    const ranger = list.find((x) => x.line.includes('Ranger 1000'))!;
    expect(ranger.line).toMatch(/^U\d+ \| 2027 Polaris Ranger 1000/);
    expect(ranger.line).toMatch(/2 in stock/);
    expect(specsFor(lot[0], bank)).toMatch(/seats 3/);
    expect(specsFor(lot[0], bank)).toMatch(/tows 2,500/);
  });

  it('a budget narrows the list, but never below 3 options (the closest beats nothing)', () => {
    const many = [...lot, unit('s2', 2027, 'Polaris', 'Sportsman 450', 'ATV', 7499), unit('s3', 2027, 'Polaris', 'Sportsman 110', 'ATV', 3499)];
    expect(candidates(many, { ...none, use: 'trail riding', budget: '$10,000' }, bank).map((x) => x.unit.title)).toEqual(['2027 Polaris Sportsman 570', '2027 Polaris Sportsman 450', '2027 Polaris Sportsman 110']);
    expect(candidates(lot, { ...none, use: 'trail riding', budget: '$5,000' }, bank)).toHaveLength(3);
  });

  it('when nothing of that kind is in stock, it still looks at everything', () => {
    expect(candidates(lot.slice(0, 4), { ...none, use: 'bass fishing boat' }, bank).length).toBeGreaterThan(0);
  });

  it("reads Claude's three picks and reasons; unknown U-numbers are ignored", () => {
    const list = candidates(lot, { ...none, use: 'farm work' }, bank);
    const r = readPicks({ text: 'U2\nU1\nU3', emailBody: 'U2 — Seats 3 and tows 2,500 lb for the hay.\nU1 — Smaller and cheaper.\nU3 — An ATV if they ride alone.', why: 'Farm work for two.' }, list);
    expect(r.picks.map((p) => p.unit.title)).toEqual([list[1].unit.title, list[0].unit.title, list[2].unit.title]);
    expect(r.picks[0].reason).toBe('Seats 3 and tows 2,500 lb for the hay.');
    expect(readPicks({ text: 'U99' }, list).picks).toEqual([]);
  });

  it('the request fits the dialer and never includes the customer', () => {
    expect(matchPrompt(DEFAULT_SETTINGS).length).toBeLessThan(8000);
    expect(matchPrompt(DEFAULT_SETTINGS)).toMatch(/closest/i);
    expect(interview({ use: 'hunting', tags: ['Family'], riders: '4', budget: '' })).toBe("What they'll use it for: hunting\nUses: Family\nRiders / people: 4");
  });
});
