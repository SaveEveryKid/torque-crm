import type { Card } from '../training/engine';
import { completeFor } from './ai';
import { allUnits, money, toVehicleRef, type Unit } from './inventory';
import type { Customer, Settings, VehicleRef } from './types';

/**
 * FIND THE RIGHT UNIT: from the customer interview (what they'll use it for,
 * riders, budget), Claude picks the 3 in-stock units that fit best, with a
 * plain reason for each. Claude only sees one line per model from the live
 * inventory (with the key specs from the Bootcamp data), never the customer's
 * name or number.
 */
export interface Needs {
  use: string;
  tags: string[];
  riders: string;
  budget: string;
}

export interface Match {
  at: string;
  summary: string;
  picks: { v: VehicleRef; reason: string; inStock: number }[];
}

export const USE_TAGS = ['Hunting', 'Farm / work', 'Trail riding', 'Family', 'Kids', 'Mud / sport', 'Fishing', 'Lake day', 'Mowing', 'Hauling a trailer'];

type Group = 'powersports' | 'water' | 'lawn' | 'trailer';

/** What kind of unit this is: its own type and name first, then the listing's category fields. */
export function groupOf(u: Unit): Group {
  const own = `${u.type ?? ''} ${u.title}`.toLowerCase();
  const all = `${own} ${String(u.raw.ProductCategory ?? '')} ${JSON.stringify(u.raw.IndustryNameLists ?? '')}`.toLowerCase();
  for (const t of [own, all]) {
    if (/\b(atv|utv)\b|side.?by|utility vehicle|ranger|rzr|sportsman|general|xpedition|grizzly|kodiak|wolverine|defender|outlander|maverick|motorcycle|dirt bike|snowmobile|youth/.test(t)) return 'powersports';
    if (/boat|pontoon|marine|outboard|mercury|bennington|lowe|hurricane|bayliner|caymas|alumacraft/.test(t)) return 'water';
    if (/mower|mow|zero[- ]turn|lawn|tractor|cub cadet|husqvarna|toro|dewalt|trimmer|blower|chainsaw/.test(t)) return 'lawn';
    if (/trailer|grey states|big tex|carry-on/.test(t)) return 'trailer';
  }
  return 'powersports';
}

/** Which kinds of units the interview points to (side-by-sides/ATVs if nothing else says so). */
export function wantedGroups(n: Needs): Group[] {
  const t = `${n.use} ${n.tags.join(' ')}`.toLowerCase();
  const g: Group[] = [];
  if (/boat|fish|lake|pontoon|tube|tubing|ski|bass|cruis|river|water|outboard|motor for/.test(t)) g.push('water');
  if (/mow|lawn|yard|grass|acre.*cut|zero.?turn|trim|blow|chainsaw/.test(t)) g.push('lawn');
  if (/trailer|haul.*(behind|trailer)|tow (it|a)|flatbed/.test(t) && !/side.?by|atv|utv/.test(t)) g.push('trailer');
  if (!g.length || /atv|utv|side.?by|four.?wheel|ranger|rzr|sportsman|general|xpedition|hunt|farm|trail|mud|ranch|feed|work|ride/.test(t)) g.push('powersports');
  return [...new Set(g)];
}

const norm = (s: string) => s.toLowerCase().replace(/\b(19|20)\d{2}\b|polaris|mercury marine|\(every trim\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Key specs for a unit from the Bootcamp data (seats, width, towing, horsepower…), matched by model name. */
export function specsFor(u: Unit, bank: Card[]): string {
  const title = norm(u.title);
  const facts = new Map<string, string>();
  const fields: [string, string][] = [
    ['Seating', 'seats'],
    ['Seating Capacity', 'holds'],
    ['Width', 'wide'],
    ['Towing Capacity', 'tows'],
    ['Cargo Box Capacity', 'box'],
    ['Horsepower', 'hp'],
    ['Power', 'hp'],
    ['Ground Clearance', 'clearance'],
    ['Steering', 'EPS'],
    ['Cutting Width', 'cuts'],
  ];
  // The longest bank model name inside this unit's title is the closest match.
  const best = new Map<string, number>();
  for (const c of bank) {
    if (!['Polaris', 'Boats', 'Mercury', 'Mowers'].includes(c.cat)) continue;
    const name = norm(c.topic);
    if (name.length < 4 || !` ${title} `.includes(` ${name} `)) continue;
    const label = fields.find(([f]) => f === c.field)?.[1];
    if (!label || (best.get(label) ?? 0) > name.length) continue;
    best.set(label, name.length);
    const v = label === 'EPS' ? (c.a.startsWith('Yes') ? 'EPS' : 'no EPS') : `${label} ${c.a.replace(/ people| person/, '')}`;
    facts.set(label, v);
  }
  return [...facts.values()].join(', ');
}

/** One line per model (with how many are in stock), the right kinds only, small enough to send. */
export function candidates(units: Unit[], needs: Needs, bank: Card[], max = 140): { line: string; unit: Unit; count: number }[] {
  const groups = wantedGroups(needs);
  // If none of that kind is on the lot, look at everything: the closest is still worth showing.
  const pool = units.some((u) => groups.includes(groupOf(u))) ? units.filter((u) => groups.includes(groupOf(u))) : units;
  const byModel = new Map<string, { unit: Unit; count: number }>();
  for (const u of pool) {
    const key = `${u.title}|${u.condition ?? ''}`.toLowerCase();
    const cur = byModel.get(key);
    if (cur) cur.count++;
    else byModel.set(key, { unit: u, count: 1 });
  }
  let list = [...byModel.values()];
  const budget = Number(needs.budget.replace(/[^0-9.]/g, '')) || 0;
  // Prefer units near the budget, but never drop below 3 options: the closest is better than nothing.
  if (budget) {
    const near = list.filter((x) => !x.unit.price || x.unit.price <= budget * 1.15);
    list = near.length >= 3 ? near : list;
  }
  if (list.length > max) {
    // Keep a spread across the lineup rather than the first N.
    const step = list.length / max;
    list = Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
  }
  return list.map((x, i) => {
    const u = x.unit;
    const specs = specsFor(u, bank);
    const line = [`U${i + 1}`, u.title, [u.type, u.condition].filter(Boolean).join(', '), u.price ? money(u.price) : '', specs, x.count > 1 ? `${x.count} in stock` : '', u.location ?? '']
      .filter(Boolean)
      .join(' | ');
    return { line, unit: u, count: x.count };
  });
}

export function matchPrompt(s: Settings): string {
  return `You are the product expert at ${s.dealership || 'the dealership'}, which sells ${s.sells || 'powersports, boats and mowers'}. A salesperson just interviewed a customer at their desk. Pick the THREE in-stock units that come CLOSEST to what this customer wants to accomplish. The perfect unit often isn't on the lot; always pick the three closest anyway, and say honestly where one falls short.

How to pick:
- Fit the USE first (work, hunting, trails, family, kids, mud/sport, fishing, lake days, mowing), then SIZE (how many riders, trail width, towing and hauling, acreage), then BUDGET only if one is given (prefer within about 15% of it; with no budget, ignore price).
- Only pick units from the list, by their U-number. Never invent a unit or a spec.
- Three different models, best fit first. When it fits, make it a good / better / best spread.
- If a 50-inch trail is mentioned, prefer units 50 inches wide or less. For families or more than 2 riders, prefer units that seat enough people.
- If nothing is a perfect fit, still pick the three closest and name the compromise in the reason (e.g. "seats 2, not 4, but it's the best hauler we have").
- Always return three picks (fewer only if the list has fewer than three).

Answer as JSON:
- text: the three U-numbers, one per line, best fit first.
- emailBody: one line per pick, "U12 — why it fits this customer", in plain words a customer would like hearing (one sentence, naming the spec that matters to them).
- emailSubject: "".
- why: one short sentence summing up what this customer needs.
- skip: false. skipReason: "".`;
}

export function interview(n: Needs): string {
  return [
    n.use.trim() && `What they'll use it for: ${n.use.trim()}`,
    n.tags.length && `Uses: ${n.tags.join(', ')}`,
    n.riders.trim() && `Riders / people: ${n.riders.trim()}`,
    n.budget.trim() && `Budget: ${n.budget.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Read Claude's picks back (U-numbers → units, with reasons). */
export function readPicks(raw: unknown, list: { unit: Unit; count: number }[]): { summary: string; picks: { unit: Unit; reason: string; count: number }[] } {
  const d = (raw ?? {}) as { text?: string; emailBody?: string; why?: string };
  const reasons = new Map<number, string>();
  for (const line of String(d.emailBody ?? '').split('\n')) {
    const m = /U(\d+)\s*[—–:-]+\s*(.+)/.exec(line);
    if (m) reasons.set(Number(m[1]), m[2].trim());
  }
  const ids = [...new Set([...String(d.text ?? '').matchAll(/U(\d+)/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= list.length);
  return { summary: d.why ?? '', picks: ids.slice(0, 3).map((n) => ({ unit: list[n - 1].unit, count: list[n - 1].count, reason: reasons.get(n) ?? '' })) };
}

export async function findMatches(c: Customer, s: Settings, needs: Needs): Promise<Match> {
  if (!interview(needs)) throw new Error('Tell me what they want to do with it first.');
  const [units, bank] = await Promise.all([allUnits(s.inventoryPage), import('../training/bank.json').then((m) => (m.default as { cards: Card[] }).cards)]);
  let list = candidates(units, needs, bank);
  if (!list.length) throw new Error('No in-stock units of that kind right now.');
  const system = matchPrompt(s);
  const head = `CUSTOMER INTERVIEW\n${interview(needs)}${c.trade ? `\nTrade: ${c.trade}` : ''}\n\nIN STOCK (one line per model)\n`;
  // Stay inside the dialer's size limit.
  while (system.length + head.length + list.reduce((n, x) => n + x.line.length + 1, 0) > 21_000 && list.length > 20) list = list.slice(0, Math.floor(list.length * 0.8));
  const raw = await completeFor(s)([
    { role: 'system', content: system },
    { role: 'user', content: head + list.map((x) => x.line).join('\n') },
  ]);
  const r = readPicks(raw, list);
  if (!r.picks.length) throw new Error("Claude's answer didn't name any units. Try again.");
  return { at: new Date().toISOString(), summary: r.summary, picks: r.picks.map((p) => ({ v: toVehicleRef(p.unit), reason: p.reason, inStock: p.count })) };
}
