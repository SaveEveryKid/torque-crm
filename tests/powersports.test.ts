import { describe, expect, it } from 'vitest';
import { systemPrompt } from '../src/core/ai/followUp';
import { replyPrompt } from '../src/core/ai/replyHelper';
import { shortVehicle } from '../src/core/analysis/opener';
import { DEFAULT_SETTINGS } from '../src/crm/types';
import { writerOf } from '../src/crm/ai';

describe('Claude knows this is a powersports store', () => {
  const w = writerOf(DEFAULT_SETTINGS);

  it('says what the store sells and never uses car examples', () => {
    for (const p of [systemPrompt(w), replyPrompt(w)]) {
      expect(p).toMatch(/Shoals Outdoor Sports sells powersports/);
      expect(p).toMatch(/NOT a car dealer/);
      expect(p).not.toMatch(/Tundra|Sierra|Tacoma|RAV4|Denali|looking at trucks|come drive it/);
    }
  });

  it('still fits the dialer limit', () => {
    expect(systemPrompt(w).length).toBeLessThan(8000);
  });

  it('short names for powersports units', () => {
    expect(shortVehicle('2025 Yamaha Grizzly 700 EPS')).toBe('the Grizzly');
    expect(shortVehicle('New 2024 Can-Am Defender HD9')).toBe('the Defender');
    expect(shortVehicle('')).toBe('the one you asked about');
  });
});
