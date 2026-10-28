/**
 * Short, non-reversible-in-practice reference for audit logs, so the log can
 * say "record X was parsed" without storing the customer's name or IDs.
 * (FNV-1a; not a security primitive — just keeps PII out of the log.)
 */
export function recordRef(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'r_' + (h >>> 0).toString(16).padStart(8, '0');
}
