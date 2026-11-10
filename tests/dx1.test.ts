import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readUnit } from '../src/crm/inventory';

describe('a real Shoals Outdoor Sports listing (DX1)', () => {
  const u = readUnit(JSON.parse(readFileSync(join(__dirname, 'fixtures', 'dx1-hit.json'), 'utf8')));
  it('reads the photo, the gallery and the website link', () => {
    expect(u.image).toMatch(/6000000006\.jpg$/);
    expect(u.photos).toHaveLength(6);
    expect(u.photos[0]).toBe(u.image);
    expect(u.url).toBe('https://www.shoalsoutdoorsports.com/dx1inventory/8b3df5b0-d643-46a6-9faf-b4ea0160719b');
  });
  it('reads the unit itself; no "0 mi" for a boat', () => {
    expect(u).toMatchObject({ title: "1978 Alumacraft 16' YAMAHA 1997 35OB", price: 3999, stock: 'H4513A', condition: 'Used', type: 'Boat', usage: null });
  });
});

import { usefulFacets as facetsOf } from '../src/crm/inventory';
describe('inventory location filter', () => {
  it('the store (DealershipName) is offered first, as Location', () => {
    const f = facetsOf({ DealershipName: { 'Shoals Outdoor Sports - Tuscumbia': 330, 'Shoals Outdoor Sports - Florence': 298 }, Condition: { New: 400, Used: 228 } });
    expect(f.map((x) => [x.name, x.label])).toEqual([
      ['DealershipName', 'Location'],
      ['Condition', 'Condition'],
    ]);
  });
});

describe('Refresh: what changed on the website', async () => {
  const { diffInventory, snapshotOf } = await import('../src/crm/inventory');
  const unit = (id: string, price: number | null) => ({ id, title: `Unit ${id}`, stock: `S${id}`, price }) as never;
  it('finds new units, units gone from the website and price changes', () => {
    const before = snapshotOf([unit('a', 5699), unit('b', 11999), unit('c', 7499)], 'Shoals Outdoor Sports - Florence');
    const c = diffInventory(before, [unit('a', 5699), unit('b', 11499), unit('d', 3999)])!;
    expect(c.added.map((u: { id: string }) => u.id)).toEqual(['d']);
    expect(c.gone.map((g) => g.id)).toEqual(['c']);
    expect(c.repriced.map((r) => [r.from, r.to])).toEqual([[11999, 11499]]);
    expect(c.total).toBe(3);
  });
  it('the first refresh has nothing to compare with', () => {
    expect(diffInventory(null, [unit('a', 1)])).toBeNull();
  });
});
