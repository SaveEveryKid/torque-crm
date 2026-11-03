import { describe, expect, it } from 'vitest';
import { kv } from '../src/core/storage/kv';
import { withSignature } from '../src/crm/email';
import { getSettings, saveSettings } from '../src/crm/store';
import { DEFAULT_SIGNATURE } from '../src/crm/types';

describe('email signature', () => {
  it('is on by default (replacing the old blank one) and added once to the bottom of every email', async () => {
    await kv.set({ settings: { signature: '' } });
    const s = await getSettings();
    expect(s.signature).toBe(DEFAULT_SIGNATURE);
    expect(s.signature.split('\n')[0]).toBe('Byron Green');
    expect(s.signature).toContain('Sales Consultant-Florence');
    const body = withSignature('Hi Martin,\n\nQuick question.\n\nByron', s.signature);
    expect(body).toBe(`Hi Martin,\n\nQuick question.\n\nByron\n\n${DEFAULT_SIGNATURE}`);
    expect(withSignature(body, s.signature)).toBe(body);
  });

  it('keeps one you set yourself, even blank', async () => {
    await saveSettings({ signature: '', signatureSet: true });
    expect((await getSettings()).signature).toBe('');
  });
});
