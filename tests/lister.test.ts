import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The extension's plain scripts attach to `self.Byron`; load them the same way here.
const load = (...files: string[]) => {
  const self: Record<string, unknown> = {};
  for (const f of files) new Function('self', 'window', readFileSync(`extension/${f}`, 'utf8'))(self, self);
  return self.Byron as {
    constants: { DESCRIPTION: string; VEHICLE_TYPE: string; LOCATION: string; MAX_PHOTOS: number; STORE_LOGO_CORNER: string; WATERMARKS: { file: string; width: number; corner: string; opacity: number }[] };
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
    expect(B.constants.DESCRIPTION.startsWith('✅️ NO DEALER FEES! ✅️\n\n⏳️ Message me')).toBe(true);
    expect(B.constants.DESCRIPTION.endsWith('‼️ Follow me on Marketplace for the best deals! ‼️\n\nShoals Outdoor Sports- Florence, AL\nwww.shoalsoutdoorsports.com')).toBe(true);
    expect(B.constants.DESCRIPTION).not.toContain('Proudly serving');
    expect(B.constants.DESCRIPTION).not.toContain('For Sale By Dealer');
  });

  it('three slightly see-through watermarks, one per corner, leaving bottom-right for the store logo', () => {
    const W = B.constants.WATERMARKS;
    expect(W.map((m) => [m.file, m.corner])).toEqual([
      ['watermarks/no-dealer-fees.png', 'top-left'],
      ['watermarks/easy-buying.png', 'top-right'],
      ['watermarks/call-byron.png', 'bottom-left'],
    ]);
    expect(B.constants.STORE_LOGO_CORNER).toBe('bottom-right');
    for (const m of W) expect(m.opacity).toBeGreaterThan(0.7), expect(m.opacity).toBeLessThan(1);
    const fees = B.watermark.cornerSpec(W[0], 'top-left');
    expect(B.watermark.placement(1920, 1440, 1400, 477, fees)).toEqual({ x: 48, y: 43, w: 653, h: 222 });
    const tr = B.watermark.placement(1920, 1440, 1477, 864, B.watermark.cornerSpec(W[1], 'top-right'));
    expect(tr.x + tr.w).toBe(1872);
    const bl = B.watermark.placement(1920, 1440, 2027, 866, B.watermark.cornerSpec(W[2], 'bottom-left'));
    expect([bl.x, bl.y + bl.h]).toEqual([48, 1397]);
    // A wide, short photo: the logo is kept under a third of the height.
    expect(B.watermark.placement(3000, 600, 1400, 477, fees).h).toBeLessThanOrEqual(200);
  });

  it('when the store logo is in another corner, that watermark moves to the free one', () => {
    const W = B.constants.WATERMARKS;
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
