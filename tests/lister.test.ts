import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The extension's plain scripts attach to `self.Byron`; load them the same way here.
const load = (...files: string[]) => {
  const self: Record<string, unknown> = {};
  for (const f of files) new Function('self', 'window', readFileSync(`extension/${f}`, 'utf8'))(self, self);
  return self.Byron as {
    constants: { DESCRIPTION: string; describe: (p: number | null) => string; VEHICLE_TYPE: string; LOCATION: string; MAX_PHOTOS: number; STORE_LOGO_CORNER: string; WATERMARKS: { file?: string; width: number; corner: string; opacity: number }[]; PAYMENT_MARK: { file?: string; width: number; corner: string; opacity: number } };
    watermark: {
      placement: (pw: number, ph: number, mw: number, mh: number, spec: object) => { x: number; y: number; w: number; h: number };
      isStoreFramed: (px: Uint8ClampedArray) => boolean;
      cornerSpec: (spec: object, corner: string) => object;
      arrange: (specs: object[], logo: string | null, usual: string) => { corner: string }[];
      logoCorner: (gray: Float32Array, w: number, h: number, t: { w: number; h: number; data: Float32Array }[]) => string | null;
    };
  };
};

describe('Torque Marketplace Lister (extension)', () => {
  const B = load('lib/constants.js', 'lib/utils.js', 'lib/watermark.js');

  it('lists as vehicle type Other, in Florence, with the exact description', () => {
    expect(B.constants.VEHICLE_TYPE).toBe('Other');
    expect(B.constants.LOCATION).toBe('Florence, Alabama');
    expect(B.constants.MAX_PHOTOS).toBe(20);
    // The payment you typed, exactly (from your grid).
    expect(B.constants.describe(100)).toBe(
      'Payments as low as $100/mo (WAC)\n✅️ NO HIDDEN FEES! ✅️\n\n\nOptional accessories not included in pricing...message for more details.\n\n⏳️ Message me with any questions or to set up a time to see this unit! ⏳️\n\nShoals Outdoor Sports- Florence, AL\n🌐 shoalsoutdoorsports dot com',
    );
    expect(B.constants.describe(1234.5)).toContain('Payments as low as $1,234.50/mo (WAC)');
    expect(B.constants.describe(99.99)).toContain('Payments as low as $99.99/mo (WAC)');
    // No payment: that line is left out.
    expect(B.constants.describe(null)).toBe(B.constants.describe(100).replace('Payments as low as $100/mo (WAC)\n', ''));
    expect(B.constants.describe(null).startsWith('✅️ NO HIDDEN FEES! ✅️')).toBe(true);
    expect(B.constants.describe(0)).not.toContain('{payment}');
    expect(B.constants.DESCRIPTION).not.toContain('Proudly serving');
    // Facebook flags links as spam: the website is spelled out.
    expect(B.constants.DESCRIPTION).not.toMatch(/www\.|\.com|https?:/);
    expect(B.constants.DESCRIPTION).not.toContain('DEALER FEES');
    expect(B.constants.DESCRIPTION).not.toContain('For Sale By Dealer');
  });

  it('three slightly see-through watermarks, one per corner, leaving bottom-right for the store logo (no phone number)', () => {
    const W = [...B.constants.WATERMARKS, B.constants.PAYMENT_MARK];
    expect(W.map((m) => [m.file ?? 'payment (drawn per listing)', m.corner])).toEqual([
      ['watermarks/no-dealer-fees.png', 'top-left'],
      ['watermarks/easy-buying.png', 'top-right'],
      ['payment (drawn per listing)', 'bottom-left'],
    ]);
    expect(JSON.stringify(B.constants)).not.toMatch(/call-byron|762-0959/i);
    expect(B.constants.STORE_LOGO_CORNER).toBe('bottom-right');
    for (const m of W) expect(m.opacity).toBeGreaterThan(0.7), expect(m.opacity).toBeLessThan(1);
    const fees = B.watermark.cornerSpec(W[0], 'top-left');
    expect(B.watermark.placement(1920, 1440, 1400, 477, fees)).toEqual({ x: 48, y: 43, w: 653, h: 222 });
    const tr = B.watermark.placement(1920, 1440, 1477, 864, B.watermark.cornerSpec(W[1], 'top-right'));
    expect(tr.x + tr.w).toBe(1872);
    const bl = B.watermark.placement(1920, 1440, 1400, 434, B.watermark.cornerSpec(W[2], 'bottom-left'));
    expect([bl.x, bl.y + bl.h]).toEqual([48, 1397]);
    // A wide, short photo: the logo is kept under a third of the height.
    expect(B.watermark.placement(3000, 600, 1400, 477, fees).h).toBeLessThanOrEqual(200);
  });

  it('when the store logo is in another corner, that watermark moves to the free one', () => {
    const W = [...B.constants.WATERMARKS, B.constants.PAYMENT_MARK];
    const corners = (logo: string | null) => B.watermark.arrange(W, logo, 'bottom-right').map((s) => s.corner);
    expect(corners(null)).toEqual(['top-left', 'top-right', 'bottom-left']);
    expect(corners('bottom-right')).toEqual(['top-left', 'top-right', 'bottom-left']);
    expect(corners('top-left')).toEqual(['bottom-right', 'top-right', 'bottom-left']);
    expect(corners('top-right')).toEqual(['top-left', 'bottom-right', 'bottom-left']);
    expect(corners('bottom-left')).toEqual(['top-left', 'top-right', 'bottom-right']);
  });

  it('finds the store logo in whichever corner it is (and nowhere when there is none)', () => {
    // A stand-in "logo" pattern, and a noisy photo it's pasted into.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 255;
    const logo = { w: 30, h: 22, data: Float32Array.from({ length: 30 * 22 }, (_, i) => ((i % 30) * 7 + Math.floor(i / 30) * 13) % 255) };
    const photo = (corner: string | null) => {
      const Wd = 240, Hd = 180, g = Float32Array.from({ length: Wd * Hd }, rnd);
      if (corner) {
        const x0 = /right/.test(corner) ? Wd - 40 : 8, y0 = /^bottom/.test(corner) ? Hd - 30 : 6;
        for (let y = 0; y < logo.h; y++) for (let x = 0; x < logo.w; x++) g[(y0 + y) * Wd + x0 + x] = logo.data[y * logo.w + x];
      }
      return B.watermark.logoCorner(g, Wd, Hd, [logo]);
    };
    for (const c of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) expect(photo(c)).toBe(c);
    expect(photo(null)).toBeNull();
  });

  it("photos with the store's branded frame are recognised (and left out), plain photos are not", () => {
    const fill = (f: (i: number) => [number, number, number]) => {
      const a = new Uint8ClampedArray(4 * 5000);
      for (let i = 0; i < 5000; i++) a.set([...f(i), 255], i * 4);
      return a;
    };
    expect(B.watermark.isStoreFramed(fill(() => [207, 216, 223]))).toBe(true);
    expect(B.watermark.isStoreFramed(fill((i) => [205 + (i % 3), 216, 224]))).toBe(true);
    // Gravel, grass, sky: not a frame.
    expect(B.watermark.isStoreFramed(fill((i) => [(i * 37) % 255, (i * 91) % 255, (i * 13) % 255]))).toBe(false);
    expect(B.watermark.isStoreFramed(fill(() => [120, 170, 230]))).toBe(false);
  });

  it('only Torque CRM can start a listing, and only with the dealer’s photos', () => {
    const bg = readFileSync('extension/background.js', 'utf8');
    expect(bg).toMatch(/CRM_ORIGINS\.indexOf\(origin\) === -1/);
    expect(bg).toMatch(/PHOTO_HOST\.test\(host\)/);
    // It never clicks Publish.
    expect(readFileSync('extension/content/facebook.js', 'utf8')).not.toMatch(/publish[^\n]*\.click\(/i);
  });
});

describe('Listed on Marketplace (CRM side)', async () => {
  const { mergeListed } = await import('../src/crm/lister');
  it("adds what the extension sent to Facebook, but keeps a newer 'not listed' you set", () => {
    const ours = { a: { at: '2026-11-02T10:00:00Z', title: 'A' }, b: { at: '2026-11-03T12:00:00Z', title: 'B', off: true } };
    const theirs = { a: { at: '2026-11-02T10:00:00Z', title: 'A' }, b: { at: '2026-11-03T09:00:00Z', title: 'B' }, c: { at: '2026-11-03T11:00:00Z', title: 'C' } };
    expect(mergeListed(ours, theirs)).toEqual({ ...ours, c: { at: '2026-11-03T11:00:00Z', title: 'C' } });
    // Listed again after being unmarked: back on.
    expect(mergeListed(ours, { b: { at: '2026-11-03T13:00:00Z', title: 'B' } })!.b).toEqual({ at: '2026-11-03T13:00:00Z', title: 'B' });
    // Nothing new: no save.
    expect(mergeListed(ours, { a: ours.a })).toBeNull();
  });
});

describe('Your own photos (CRM side)', async () => {
  const { toListing } = await import('../src/crm/lister');
  const { logoPlacement } = await import('../src/crm/ownPhotos');
  it('are sent with the listing, in your order, alongside dealer photos', () => {
    const u = { id: 'u1', title: '2026 Polaris Sportsman 450', year: '2026', make: 'Polaris', model: 'Sportsman 450', price: 5699, photos: [] } as never;
    const mine = 'data:image/jpeg;base64,AAAA';
    const l = toListing(u, [mine, 'https://cdpcdn.dx1app.com/a.jpg', 'data:image/jpeg;base64,BBBB'], 100, null);
    expect(l.photos).toEqual(['upload:0', 'https://cdpcdn.dx1app.com/a.jpg', 'upload:1']);
    expect(l.uploads).toEqual([mine, 'data:image/jpeg;base64,BBBB']);
  });
  it('get the store logo bottom-right, about a fifth of the width', () => {
    const p = logoPlacement(2048, 1536, 416, 297);
    expect(p.w).toBe(430);
    expect(p.x + p.w).toBe(2048 - 46);
    expect(p.y + p.h).toBe(1536 - 46);
    // A tall phone photo: a bit bigger so it reads the same.
    expect(logoPlacement(1536, 2048, 416, 297).w).toBe(461);
  });
});
