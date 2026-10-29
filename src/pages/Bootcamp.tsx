import { useEffect, useMemo, useRef, useState } from 'react';
import { kv } from '../core/storage/kv';
import { useStoredKey } from '../crm/store';
import {
  DAILY_GOAL,
  EMPTY_PROGRESS,
  MASTERED,
  buildSession,
  checkTyped,
  currentStreak,
  dayOf,
  dueCards,
  grade,
  level,
  mastery,
  points,
  questionFor,
  recordDay,
  type Card,
  type CardState,
  type Mode,
  type Progress,
  type Question,
} from '../training/engine';
import { Icon } from '../ui/kit';

/**
 * PRODUCT BOOTCAMP: every product the store sells, learned a little every day.
 * Progress is saved to your Cloudflare database (one row per fact), so it's
 * the same on every device.
 */
type Stats = Omit<Progress, 'cards'>;
const STATS_DEFAULT: Stats = (({ cards: _c, ...rest }) => rest)(EMPTY_PROGRESS);

function useBank() {
  const [bank, setBank] = useState<Card[] | null>(null);
  useEffect(() => {
    void import('../training/bank.json').then((m) => setBank((m.default as { cards: Card[] }).cards));
  }, []);
  return bank;
}

function useProgress(): [Progress, (cards: Record<string, CardState>, stats: Stats) => void] {
  const stats = useStoredKey<Stats>('training', STATS_DEFAULT);
  const cards = useStoredKey<Record<string, CardState>>('trainingCards', {});
  const p = useMemo(() => ({ ...STATS_DEFAULT, ...stats, cards }), [stats, cards]);
  const save = (c: Record<string, CardState>, s: Stats) => void kv.set({ trainingCards: c, training: s });
  return [p, save];
}

const CAT_ICON: Record<string, string> = { Polaris: '🏁', Colors: '🎨', Boats: '🚤', Mercury: '⚙️', Mowers: '🌱', Lessons: '📘', 'Product line': '🧭', Trailers: '🛻', Equipment: '🔧' };

export function Bootcamp() {
  const bank = useBank();
  const [p, save] = useProgress();
  const [run, setRun] = useState<{ mode: Mode; cards: Card[]; category?: string } | null>(null);
  if (!bank) return <div className="page"><p className="muted">Loading the bootcamp…</p></div>;
  if (run) return <Play bank={bank} p={p} save={save} run={run} onExit={() => setRun(null)} onAgain={() => setRun({ ...run, cards: buildSession(run.mode, bank, p, dayOf(), Math.random, run.category) })} />;
  return <Home bank={bank} p={p} save={save} start={(mode, category) => setRun({ mode, category, cards: buildSession(mode, bank, p, dayOf(), Math.random, category) })} />;
}

/* ---------- home ---------- */
function Home({ bank, p, save, start }: { bank: Card[]; p: Progress; save: (c: Record<string, CardState>, s: Stats) => void; start: (m: Mode, cat?: string) => void }) {
  const today = dayOf();
  const lv = level(p.xp);
  const streak = currentStreak(p, today);
  const done = p.days[today] ?? 0;
  const due = dueCards(bank, p, today).length;
  const seen = Object.keys(p.cards).length;
  const mastered = Object.values(p.cards).filter((s) => s.box >= MASTERED).length;
  const weak = bank.filter((c) => (p.cards[c.id]?.misses ?? 0) > 0).length;
  const cats = mastery(bank, p);
  const sessionSize = Math.min(30, due) + Math.min(p.newPerDay, bank.length - seen);
  const { cards: _c, ...stats } = p;
  const setStats = (patch: Partial<Stats>) => save(p.cards, { ...stats, ...patch });

  return (
    <div className="page bootcamp">
      <section className="boot-hero card">
        <div className="boot-level">
          <div className="ring" style={{ ['--pct' as string]: `${Math.round(lv.progress * 100)}%` }}>
            <span>{lv.level}</span>
          </div>
          <div>
            <div className="eyebrow">LEVEL {lv.level}</div>
            <h1>{lv.rank}</h1>
            <p className="soft">
              {p.xp.toLocaleString()} XP · {lv.toNext.toLocaleString()} to level {lv.level + 1}
            </p>
          </div>
        </div>
        <div className="boot-stats">
          <div className={`streak${streak ? ' hot' : ''}`}>
            <span className="flame">🔥</span>
            <strong>{streak}</strong>
            <small>day streak</small>
          </div>
          <div className="goal">
            <div className="goal-bar">
              <i style={{ width: `${Math.min(100, (done / DAILY_GOAL) * 100)}%` }} />
            </div>
            <small>
              {done >= DAILY_GOAL ? `Daily goal done ✓ (${done} answered)` : `${done} / ${DAILY_GOAL} answered today`}
            </small>
          </div>
        </div>
        <button className="btn primary boot-go" disabled={!sessionSize} onClick={() => start('daily')}>
          <Icon name="sparkle" /> {done ? "Keep going: today's bootcamp" : "Start today's bootcamp"} · {sessionSize} questions
        </button>
        <p className="muted small boot-sub">
          {due} reviews due · {Math.min(p.newPerDay, bank.length - seen)} new facts · {seen.toLocaleString()} of {bank.length.toLocaleString()} facts seen · {mastered.toLocaleString()} mastered
        </p>
      </section>

      <div className="boot-modes">
        <button className="card boot-mode" onClick={() => start('speed')}>
          <span className="emoji">⚡</span>
          <strong>Speed Round</strong>
          <small>60 seconds. As many as you can. Best: {p.speedBest}</small>
        </button>
        <button className="card boot-mode" disabled={!weak} onClick={() => start('weak')}>
          <span className="emoji">🎯</span>
          <strong>Weak Spots</strong>
          <small>{weak ? `Your ${Math.min(15, weak)} most-missed facts` : 'Nothing missed yet'}</small>
        </button>
        <div className="card boot-mode static">
          <span className="emoji">🏆</span>
          <strong>{p.sessions} sessions</strong>
          <small>
            {p.perfect} perfect · best combo {p.bestCombo}
          </small>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Product lines</h2>
          <span className="sub">Drill one line: its reviews plus 10 new facts</span>
        </div>
        <div className="boot-cats">
          {cats.map((c) => (
            <button key={c.cat} className="boot-cat" onClick={() => start('category', c.cat)}>
              <span className="emoji">{CAT_ICON[c.cat] ?? '📦'}</span>
              <span className="grow">
                <strong>{c.cat}</strong>
                <span className="mbar">
                  <i className="seen" style={{ width: `${(c.seen / c.total) * 100}%` }} />
                  <i className="mastered" style={{ width: `${(c.mastered / c.total) * 100}%` }} />
                </span>
                <small className="muted">
                  {c.mastered} mastered · {c.seen} seen · {c.total} facts
                </small>
              </span>
              <span className="muted">Drill →</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card card-pad stack">
        <h2>Your daily plan</h2>
        <div className="row">
          <span className="soft small">New facts per day:</span>
          {[5, 10, 20, 30].map((n) => (
            <button key={n} className={`chip${p.newPerDay === n ? ' on' : ''}`} onClick={() => setStats({ newPerDay: n })}>
              {n}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="soft small">New facts from:</span>
          <button className={`chip${!p.focus.length ? ' on' : ''}`} onClick={() => setStats({ focus: [] })}>
            Everything
          </button>
          {cats.map((c) => (
            <button
              key={c.cat}
              className={`chip${p.focus.includes(c.cat) ? ' on' : ''}`}
              onClick={() => setStats({ focus: p.focus.includes(c.cat) ? p.focus.filter((x) => x !== c.cat) : [...p.focus, c.cat] })}
            >
              {c.cat}
            </button>
          ))}
        </div>
        <p className="muted small">
          Each day: your reviews (facts you're about to forget) plus new facts. Get one right and it comes back in 1, 2, 4, 7, 14, 30 then 60 days; miss it and it comes back tomorrow.
          New facts start as multiple choice; after two right answers you type them from memory. Answer {DAILY_GOAL} a day to keep your streak.
        </p>
      </section>
    </div>
  );
}

/* ---------- playing ---------- */

function Play({
  bank,
  p,
  save,
  run,
  onExit,
  onAgain,
}: {
  bank: Card[];
  p: Progress;
  save: (c: Record<string, CardState>, s: Stats) => void;
  run: { mode: Mode; cards: Card[]; category?: string };
  onExit: () => void;
  onAgain: () => void;
}) {
  const speed = run.mode === 'speed';
  const today = dayOf();
  const [queue, setQueue] = useState(run.cards);
  const [i, setI] = useState(0);
  const [requeued] = useState(() => new Set<string>());
  const [combo, setCombo] = useState(0);
  const [xp, setXp] = useState(0);
  const [right, setRight] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [result, setResult] = useState<null | { ok: boolean; picked?: number | string }>(null);
  const [typed, setTyped] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [endsAt] = useState(() => (speed ? Date.now() + 60_000 : 0));
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const live = useRef(p);
  live.current = p;

  const card = queue[i];
  const q: Question | null = useMemo(() => {
    if (!card) return null;
    const qq = questionFor(card, live.current.cards[card.id], bank);
    // Speed round: tap answers only.
    if (speed && qq.format !== 'choice') return questionFor(card, undefined, bank);
    return qq;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, i]);

  useEffect(() => {
    if (!speed || finished) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [speed, finished]);
  const left = speed ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  useEffect(() => {
    if (speed && left === 0 && !finished) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const finish = () => {
    if (finished) return;
    setFinished(true);
    const cur = live.current;
    const { cards, ...stats } = cur;
    const perfect = answered > 0 && right === answered && !speed;
    save(cards, {
      ...stats,
      xp: stats.xp + (perfect ? 25 : 0),
      sessions: stats.sessions + 1,
      perfect: stats.perfect + (perfect ? 1 : 0),
      speedBest: speed ? Math.max(stats.speedBest, right) : stats.speedBest,
    });
    if (perfect) setXp((x) => x + 25);
  };

  const answer = (ok: boolean, picked?: number | string) => {
    if (result || !q) return;
    const nextCombo = ok ? combo + 1 : 0;
    const gained = points(q, ok, combo);
    setCombo(nextCombo);
    setXp((x) => x + gained);
    setAnswered((n) => n + 1);
    if (ok) setRight((n) => n + 1);
    const cur = live.current;
    const { cards, ...stats } = cur;
    const nextCards = speed ? cards : { ...cards, [q.card.id]: grade(cards[q.card.id], ok, today) };
    const withDay = recordDay({ ...cur, cards: nextCards }, today, 1);
    const { cards: _x, ...nextStats } = withDay;
    save(nextCards, { ...nextStats, xp: stats.xp + gained, bestCombo: Math.max(stats.bestCombo, nextCombo) });
    // A miss comes back again a few questions later (once).
    if (!ok && !speed && !requeued.has(q.card.id)) {
      requeued.add(q.card.id);
      setQueue((qs) => [...qs.slice(0, i + 4), q.card, ...qs.slice(i + 4)]);
    }
    if (speed) {
      setResult({ ok, picked });
      setTimeout(next, ok ? 250 : 900);
    } else setResult({ ok, picked });
  };

  const next = () => {
    setResult(null);
    setTyped('');
    setFlipped(false);
    setI((n) => n + 1);
  };

  useEffect(() => {
    if (card === undefined && !finished) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  // Keyboard: 1-4 to pick, Enter for next.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (finished || !q) return;
      if (result && !speed && (e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        next();
      } else if (!result && q.format === 'choice' && /^[1-4]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n < q.options.length) answer(n === q.correct, n);
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  if (finished || !card || !q) {
    const lv = level(live.current.xp);
    const acc = answered ? Math.round((right / answered) * 100) : 0;
    return (
      <div className="page bootcamp">
        <section className="card boot-finish">
          <div className="big-emoji">{speed ? '⚡' : right === answered && answered ? '🏆' : '💪'}</div>
          <div className="eyebrow">{speed ? 'SPEED ROUND OVER' : right === answered && answered ? 'PERFECT SESSION · +25 BONUS' : 'SESSION COMPLETE'}</div>
          <h1>+{xp} XP</h1>
          <p className="soft">
            {speed ? `${right} right in 60 seconds${right > p.speedBest ? ' · new best!' : ''}` : `${right} of ${answered} right (${acc}%)`} · best combo this round: {Math.max(0, combo)}
          </p>
          <div className="boot-level center">
            <div className="ring" style={{ ['--pct' as string]: `${Math.round(lv.progress * 100)}%` }}>
              <span>{lv.level}</span>
            </div>
            <div>
              <strong>{lv.rank}</strong>
              <div className="muted small">
                {live.current.xp.toLocaleString()} XP · 🔥 {currentStreak(live.current, today)} day streak
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={onAgain}>
              {speed ? 'Go again' : 'Keep going'}
            </button>
            <button className="btn" onClick={onExit}>
              Back to Bootcamp
            </button>
          </div>
        </section>
      </div>
    );
  }

  const total = queue.length;
  return (
    <div className="page bootcamp">
      <div className="boot-bar">
        <button className="btn ghost sm" onClick={() => (answered ? finish() : onExit())}>
          <Icon name="x" size={16} /> {answered ? 'End' : 'Exit'}
        </button>
        <div className="grow progress">
          <i style={{ width: `${speed ? ((60 - left) / 60) * 100 : (i / total) * 100}%` }} />
        </div>
        <span className="pill">{speed ? `⏱ ${left}s` : `${i + 1} / ${total}`}</span>
        <span className={`pill combo${combo >= 3 ? ' hot' : ''}`}>🔥 {combo}</span>
        <span className="pill xp">+{xp} XP</span>
      </div>

      <section className={`card boot-q${result ? (result.ok ? ' ok' : ' bad') : ''}`}>
        <div className="eyebrow">
          {CAT_ICON[card.cat] ?? '📦'} {card.cat}
          {q.format === 'type' ? ' · TYPE IT' : q.format === 'versus' ? ' · HIGHER OR LOWER' : ''}
          {!p.cards[card.id] && !speed ? ' · NEW' : ''}
        </div>

        {q.format === 'versus' ? (
          <>
            <h2>
              {card.field}: is the <span className="hl">{card.topic}</span> higher or lower than the {q.other.topic}?
            </h2>
            <div className="versus">
              <div className="side">
                <small>{q.other.topic}</small>
                <strong>{q.other.a}</strong>
              </div>
              <div className="vs">VS</div>
              <div className="side">
                <small>{card.topic}</small>
                <strong>{result ? card.a : '?'}</strong>
              </div>
            </div>
            {!result && (
              <div className="row versus-btns">
                {(
                  [
                    [-1, '↓ Lower'],
                    [0, '= Same'],
                    [1, '↑ Higher'],
                  ] as [number, string][]
                ).map(([v, l]) => (
                  <button key={v} className="btn" onClick={() => answer(v === q.answer, v)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <h2>{card.q}</h2>
        )}

        {q.format === 'choice' && (
          <div className="options">
            {q.options.map((o, n) => (
              <button
                key={o}
                disabled={!!result}
                className={`option${result ? (n === q.correct ? ' correct' : n === result.picked ? ' wrong' : '') : ''}`}
                onClick={() => answer(n === q.correct, n)}
              >
                <span className="key">{n + 1}</span> {o}
              </button>
            ))}
          </div>
        )}

        {q.format === 'type' && !result && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) answer(checkTyped(card, typed), typed);
            }}
          >
            <input autoFocus className="grow boot-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={card.num !== undefined ? 'Type the number…' : 'Type the answer…'} />
            <button className="btn primary" disabled={!typed.trim()}>
              Check
            </button>
            <button type="button" className="btn ghost" onClick={() => answer(false, '')}>
              I don't know
            </button>
          </form>
        )}

        {q.format === 'flash' && !result && (
          <div className="stack">
            {flipped ? (
              <>
                <div className="answer-box">{card.a}</div>
                <div className="row">
                  <button className="btn green" onClick={() => answer(true)}>
                    ✓ I knew it
                  </button>
                  <button className="btn" onClick={() => answer(false)}>
                    ✗ Missed it
                  </button>
                </div>
              </>
            ) : (
              <button className="btn primary" onClick={() => setFlipped(true)}>
                Think of your answer, then show it
              </button>
            )}
          </div>
        )}

        {result && !speed && (
          <div className={`boot-feedback ${result.ok ? 'ok' : 'bad'}`}>
            <strong>{result.ok ? pick(PRAISE, i) : pick(MISS, i)}</strong>
            {q.format === 'type' && typeof result.picked === 'string' && result.picked && !result.ok && <span className="soft"> You typed “{result.picked}”.</span>}
            <div className="answer-line">
              Answer: <b>{card.a}</b>
            </div>
            <div className="soft small">{card.why}</div>
            {card.src && /^https?:/.test(card.src) && (
              <a className="small" href={card.src} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" autoFocus onClick={next}>
                Next → <span className="muted small">Enter</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const PRAISE = ['Nailed it.', 'Correct.', 'Locked in.', "That's the one.", 'Easy money.', 'Right on.'];
const MISS = ['Not this time. Lock it in:', 'Close, but no. Remember this:', "This one's coming back:", 'Learn it now:'];
const pick = (xs: string[], n: number) => xs[n % xs.length];
