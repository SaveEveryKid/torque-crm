/**
 * US phone numbers: normalize, validate, never guess.
 * A number is dialable only if it has exactly 10 digits (an optional leading
 * country code 1 is dropped) and a valid area code and exchange.
 */
export type PhoneCheck =
  | { ok: true; e164: string; display: string; digits: string }
  | { ok: false; reason: string };

export function normalizeUsPhone(raw: string | null | undefined): PhoneCheck {
  if (!raw || !raw.trim()) return { ok: false, reason: 'missing' };
  // Ignore an extension ("x123", "ext 12") rather than folding it into the number.
  const main = raw.split(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i)[0];
  let digits = main.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, reason: `${digits.length} digits` };
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (/^[01]/.test(area)) return { ok: false, reason: 'invalid area code' };
  if (/^[01]/.test(exchange)) return { ok: false, reason: 'invalid exchange' };
  if (/^\d11$/.test(area)) return { ok: false, reason: 'service code (N11)' };
  if (/^(\d)\1{9}$/.test(digits)) return { ok: false, reason: 'placeholder number' };
  if (exchange === '555' && /^01\d\d$/.test(digits.slice(6))) return { ok: false, reason: 'fictional 555-01xx number' };
  return { ok: true, e164: `+1${digits}`, display: `(${area}) ${exchange}-${digits.slice(6)}`, digits };
}
