/**
 * CONTEXT BUDGET MANAGER: assemble the AI request by priority so it always fits
 * your dialer's limit, without ever cutting the parts that matter most.
 *
 * Every section has one or more versions, fullest first (e.g. 5 recent exchanges,
 * then 4, 3, 2). Required sections are never removed. When the request is too
 * big, sections are stepped down to smaller versions in a fixed order — noise and
 * extras first, recent conversation last — until it fits. Only if the required
 * minimum itself can't fit is there an error, and it says exactly why.
 *
 * Sizes are counted in characters because that is what the dialer enforces
 * (signalwire/worker.js MAX_TOTAL). Token counts are an estimate for display.
 */

/** The dialer refuses requests over 24,000 characters (system + messages). */
export const DIALER_LIMIT = 24_000;
/** First try: well under the limit, leaving room for one retry with the problems listed. */
export const FIRST_TRY_BUDGET = 20_500;
/** Never send more than this (a safety margin below the dialer limit). */
export const HARD_BUDGET = 23_500;

export interface ContextSection {
  key: string;
  /** Shown in the debug panel. */
  label: string;
  /** Never removed or shrunk below its last version. */
  required?: boolean;
  /** Fullest first. A trailing '' means the section can be dropped entirely. */
  versions: string[];
}

export interface SectionSize {
  key: string;
  label: string;
  chars: number;
  tokens: number;
  /** Which version was used (0 = fullest). */
  version: number;
  versions: number;
}

export interface BudgetReport {
  sections: SectionSize[];
  /** Instructions sent as the system prompt (counted, never trimmed). */
  fixedChars: number;
  totalChars: number;
  totalTokens: number;
  budget: number;
  /** Plain-English list of what was shrunk to fit, in order. */
  trimmed: string[];
}

/** ~3.8 characters per token for English prose (an estimate; the dialer counts characters). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.8);
}

export function estimateContextSize(parts: string[]): { chars: number; tokens: number } {
  const chars = parts.reduce((n, p) => n + p.length, 0);
  return { chars, tokens: estimateTokens(chars) };
}

export class ContextBudgetError extends Error {
  override readonly name = 'ContextBudgetError';
  constructor(readonly report: BudgetReport) {
    const big = [...report.sections].sort((a, b) => b.chars - a.chars).slice(0, 3);
    super(
      `This customer's required context doesn't fit even after compacting: ${report.totalChars.toLocaleString()} characters ` +
        `(about ${report.totalTokens.toLocaleString()} tokens) vs a ${report.budget.toLocaleString()}-character budget. ` +
        `Largest parts: instructions ${report.fixedChars.toLocaleString()}, ${big.map((s) => `${s.label} ${s.chars.toLocaleString()}`).join(', ')}. ` +
        'Shorten your "How I sell" profile or the list note, or tell your developer.',
    );
  }
}

/**
 * Pick a version of each section so the whole request fits `budget`.
 * `shrinkOrder` lists section keys from first-to-shrink to last-to-shrink.
 */
export function fitContextToBudget(
  sections: ContextSection[],
  fixedChars: number,
  budget: number,
  shrinkOrder: string[],
  /** Joined between sections. */
  separator = '\n\n',
): { text: string; report: BudgetReport } {
  const live = sections.filter((s) => s.versions.length > 0);
  const pick = new Map(live.map((s) => [s.key, 0]));
  const trimmed: string[] = [];
  const textOf = (s: ContextSection) => s.versions[pick.get(s.key)!];
  const total = () => {
    const parts = live.map(textOf).filter(Boolean);
    return fixedChars + parts.reduce((n, p) => n + p.length, 0) + separator.length * Math.max(0, parts.length - 1);
  };

  for (const key of shrinkOrder) {
    const s = live.find((x) => x.key === key);
    if (!s) continue;
    while (total() > budget && pick.get(key)! < s.versions.length - 1) {
      pick.set(key, pick.get(key)! + 1);
      const v = pick.get(key)!;
      trimmed.push(`${s.label}: ${textOf(s) ? `shortened (step ${v} of ${s.versions.length - 1})` : 'left out'}`);
    }
    if (total() <= budget) break;
  }

  const report: BudgetReport = {
    sections: live.map((s) => {
      const chars = textOf(s).length;
      return { key: s.key, label: s.label, chars, tokens: estimateTokens(chars), version: pick.get(s.key)!, versions: s.versions.length };
    }),
    fixedChars,
    totalChars: total(),
    totalTokens: estimateTokens(total()),
    budget,
    trimmed,
  };
  if (report.totalChars > budget) throw new ContextBudgetError(report);
  return { text: live.map(textOf).filter(Boolean).join(separator), report };
}

// ------------------------------------------------------------------ learning

/**
 * What Claude learns from on each request. The profile is permanent and never
 * trimmed; examples and winners are lists of versions (fullest first, '' last).
 */
export interface LearningParts {
  profile: string;
  examples: string[];
  winners: string[];
}

export const NO_LEARNING: LearningParts = { profile: '', examples: [], winners: [] };

/** Plain learning text (older callers / tests pass a string): treated as droppable examples. */
export function asLearningParts(style: string | LearningParts | null | undefined): LearningParts {
  if (!style) return NO_LEARNING;
  return typeof style === 'string' ? { profile: '', examples: style ? [style, ''] : [], winners: [] } : style;
}

export function learningSections(parts: LearningParts): ContextSection[] {
  return [
    ...(parts.profile ? [{ key: 'profile', label: '"How I sell" profile', required: true, versions: [parts.profile.trimEnd()] }] : []),
    ...(parts.winners.some(Boolean) ? [{ key: 'winners', label: 'Messages that worked', versions: parts.winners.map((w) => w.trimEnd()) }] : []),
    ...(parts.examples.some(Boolean) ? [{ key: 'examples', label: 'Your unlearned edits', versions: parts.examples.map((e) => e.trimEnd()) }] : []),
  ];
}

/**
 * Learning text for requests that aren't built section by section (Reply helper,
 * appointment texts): the whole profile, then the biggest extras that still fit `room`.
 */
export function learningText(style: string | LearningParts | null | undefined, room: number): string {
  const parts = asLearningParts(style);
  let out = parts.profile;
  for (const list of [parts.winners, parts.examples]) {
    const fit = list.find((v) => (out + v).length <= room) ?? '';
    out += fit;
  }
  return out;
}
