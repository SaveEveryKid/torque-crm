import { kv } from '../core/storage/kv';
import { completeFor } from './ai';
import type { Unit } from './inventory';
import { useStoredKey } from './store';
import type { Settings } from './types';

/**
 * THE SHORT PRODUCT BLURB at the top of a Marketplace listing: one or two
 * plain sentences on what the unit is and who it's for, e.g. "A youth
 * side-by-side built for family off-road adventures! A great option for
 * younger riders learning the ropes under adult supervision." Claude writes
 * it from the model and the website's own description; you can edit it.
 */
export const MAX_BLURB = 200;

const strip = (html: unknown) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** What Claude gets to go on: the model, its type and the website's words (no prices). */
export function blurbFacts(u: Unit): string {
  const raw = u.raw as Record<string, unknown>;
  const about = strip(raw.LongDescription).slice(0, 700);
  const specs = strip(raw.Specs)
    .replace(/[,;]?\s*Warranty:[^,]*/i, '')
    .slice(0, 500);
  return [`Unit: ${u.title}`, u.condition && `Condition: ${u.condition}`, u.type && `Type: ${u.type}`, about && `Maker's description: ${about}`, specs && `Some specs: ${specs}`].filter(Boolean).join('\n');
}

const SYSTEM = `You write the first line of a Facebook Marketplace listing for a powersports dealer (Shoals Outdoor Sports, Florence, Alabama).
Write ONE or TWO short sentences, ${MAX_BLURB} characters at most, saying what this machine is and who it's great for, in plain friendly words a buyer scrolling Marketplace gets at a glance.
Example (a Polaris Ranger 150 EFI): "A youth side-by-side built for family off-road adventures! A great option for younger riders learning the ropes under adult supervision."
Rules: only facts from what you're given; no prices, payments, fees, phone numbers, websites or emojis; no "unbeatable", "best deal", "don't miss" hype; don't repeat the full model name word for word (the title already has it).
Answer in the JSON shape you're given: put the description in "text"; set "skip" to false, "why" to a few words on your angle, and "skipReason", "emailSubject" and "emailBody" to "".`;

/** Tidy and check a blurb: one or two sentences, short, no prices or links. */
export function cleanBlurb(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > MAX_BLURB + 40) return null;
  if (/\$|\bwww\.|https?:|\.com\b|\d{3}[-.\s]\d{3}[-.\s]\d{4}/i.test(t)) return null;
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 2) return null;
  return t;
}

export async function writeBlurb(u: Unit, s: Settings): Promise<string> {
  const complete = completeFor(s);
  let note = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = (await complete([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${blurbFacts(u)}${note}` },
    ])) as { text?: unknown; blurb?: unknown } | string | null;
    // Your dialer answers in the follow-up shape: the description is in "text".
    const text = typeof raw === 'string' ? raw : (raw?.text ?? raw?.blurb);
    const ok = cleanBlurb(text);
    if (ok) return ok;
    note = `\n\n(Your last answer didn't fit: keep it to one or two sentences under ${MAX_BLURB} characters, no prices or links, in \"text\".)`;
  }
  throw new Error("Claude's description didn't fit (too long or had prices/links). Type one in, or try Rewrite.");
}

/** Saved per unit (so listing again starts with the same words). */
export type Blurbs = Record<string, string>;
export const useBlurbs = () => useStoredKey<Blurbs>('marketplaceBlurbs', {});
export async function saveBlurb(id: string, text: string): Promise<void> {
  const m = ((await kv.get('marketplaceBlurbs')).marketplaceBlurbs as Blurbs | undefined) ?? {};
  if (m[id] === text) return;
  const next = { ...m };
  if (text.trim()) next[id] = text.trim();
  else delete next[id];
  await kv.set({ marketplaceBlurbs: next });
}
