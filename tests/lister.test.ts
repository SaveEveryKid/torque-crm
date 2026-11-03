import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The extension's plain scripts attach to `self.Byron`; load them the same way here.
const load = (...files: string[]) => {
  const self: Record<string, unknown> = {};
  for (const f of files) new Function('self', 'window', readFileSync(`extension/${f}`, 'utf8'))(self, self);
  return self.Byron as {
    constants: { DESCRIPTION: string; VEHICLE_TYPE: string; LOCATION: string; MAX_PHOTOS: number; WATERMARKS: { file: string; width: number; x: number; y: number; anchor: string; opacity: number }[] };
    watermark: { placement: (pw: number, ph: number, mw: number, mh: number, spec: object) => { x: number; y: number; w: number; h: number } };
  };
};

describe('Torque Marketplace Lister (extension)', () => {
  const B = load('lib/constants.js', 'lib/utils.js', 'lib/watermark.js');

  it('lists as vehicle type Other, in Florence, with the exact description', () => {
    expect(B.constants.VEHICLE_TYPE).toBe('Other');
    expect(B.constants.LOCATION).toBe('Florence, Alabama');
    expect(B.constants.MAX_PHOTOS).toBe(20);
    expect(B.constants.DESCRIPTION.startsWith('✅️ NO DEALER FEES! ✅️\n\n⏳️ Message me')).toBe(true);
    expect(B.constants.DESCRIPTION).toContain('For Sale By Dealer:');
    expect(B.constants.DESCRIPTION.endsWith('👉 Message me now and let me make it easy!')).toBe(true);
  });

  it('two slightly see-through watermarks: No Dealer Fees top-left, Call Byron bottom-center, inside the photo', () => {
    const [fees, call] = B.constants.WATERMARKS;
    expect(fees.file).toBe('watermarks/no-dealer-fees.png');
    expect(call.file).toBe('watermarks/call-byron.png');
    for (const m of B.constants.WATERMARKS) expect(m.opacity).toBeGreaterThan(0.7), expect(m.opacity).toBeLessThan(1);
    const a = B.watermark.placement(1920, 1440, 1400, 477, fees);
    expect(a).toEqual({ x: 48, y: 43, w: 653, h: 222 });
    const b = B.watermark.placement(1920, 1440, 1400, 467, call);
    expect(b.x + b.w / 2).toBeCloseTo(960, -1);
    expect(b.y + b.h).toBeLessThanOrEqual(1440);
    // A wide, short photo: the logo is kept under a third of the height.
    expect(B.watermark.placement(3000, 600, 1400, 477, fees).h).toBeLessThanOrEqual(200);
  });

  it('only Torque CRM can start a listing, and only with the dealer’s photos', () => {
    const bg = readFileSync('extension/background.js', 'utf8');
    expect(bg).toMatch(/CRM_ORIGINS\.indexOf\(origin\) === -1/);
    expect(bg).toMatch(/PHOTO_HOST\.test\(host\)/);
    // It never clicks Publish.
    expect(readFileSync('extension/content/facebook.js', 'utf8')).not.toMatch(/publish[^\n]*\.click\(/i);
  });
});
