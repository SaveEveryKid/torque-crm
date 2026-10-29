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
