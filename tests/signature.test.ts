import { describe, expect, it } from 'vitest';
import { kv } from '../src/core/storage/kv';
import { withSignature } from '../src/crm/email';
import { getSettings, saveSettings } from '../src/crm/store';
import { DEFAULT_SIGNATURE } from '../src/crm/types';

describe('email signature', () => {
  it('none from Torque by default: Outlook adds yours', async () => {
    await kv.set({ settings: {} });
    const s = await getSettings();
    expect(s.signature).toBe('');
    expect(withSignature('Hi Martin,\n\nQuick question.\n\nByron', s.signature)).toBe('Hi Martin,\n\nQuick question.\n\nByron');
  });

  it('drops the signature Torque used to add, even if it was saved', async () => {
    await saveSettings({ signature: DEFAULT_SIGNATURE, signatureSet: true });
    expect((await getSettings()).signature).toBe('');
    await kv.set({ settings: { signature: 'Byron Green\nShoals Outdoor Sports\n(256) 762-0959\nbyrong@shoalsoutdoorsports.com' } });
    expect((await getSettings()).signature).toBe('');
  });

  it('an extra line you type yourself in Settings is still added', async () => {
    await saveSettings({ signature: 'Ask about our winter specials', signatureSet: true });
    expect(withSignature('Hi', (await getSettings()).signature)).toBe('Hi\n\nAsk about our winter specials');
  });
});
