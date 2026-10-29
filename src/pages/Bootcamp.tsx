import { useEffect, useMemo, useRef, useState } from 'react';
import { kv } from '../core/storage/kv';
import { useStoredKey } from '../crm/store';
import {
  DAILY_GOAL,
  EMPTY_PROGRESS,
  LEARN_RUN,
  Trainer,
  inProgress,
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
import { Listen } from './Listen';

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

const CAT_ICON: Record<string, string> = { Polaris: '🏁', Colors: '🎨', Compare: '⚖️', Boats: '🚤', Mercury: '⚙️', Mowers: '🌱', Lessons: '📘', 'Product line': '🧭', Trailers: '🛻', Equipment: '🔧' };

export function Bootcamp() {
  const bank = useBank();
  const [p, save] = useProgress();
  // A new key each start: "Keep going" gets a fresh session instead of the finished one.
  const [run, setRun] = useState<{ mode: Mode; category?: string; key: number } | null>(null);
  const [listening, setListening] = useState(false);
  if (!bank) return <div className="page"><p className="muted">Loading the bootcamp…</p></div>;
  const start = (mode: Mode, category?: string) => setRun({ mode, category, key: Date.now() });
  if (listening) {
    const { cards, ...stats } = p;
    return <Listen listened={p.listened ?? {}} onListened={(id) => save(cards, { ...stats, listened: { ...(p.listened ?? {}), [id]: new Date().toISOString() } })} onBack={() => setListening(false)} />;
  }
  if (run) return <Play key={run.key} bank={bank} p={p} save={save} run={run} onExit={() => setRun(null)} onAgain={() => start(run.mode, run.category)} />;
  return <Home bank={bank} p={p} save={save} start={start} listen={() => setListening(true)} />;
}

/* ---------- home ---------- */
function Home({ bank, p, save, start, listen }: { bank: Card[]; p: Progress; save: (c: Record<string, CardState>, s: Stats) => void; start: (m: Mode, cat?: string) => void; listen: () => void }) {
  const today = dayOf();
  const lv = level(p.xp);
  const streak = currentStreak(p, today);
  const done = p.days[today] ?? 0;
  const due = dueCards(bank, p, today).length;
  const seen = Object.keys(p.cards).length;
    const weak = bank.filter((c) => (p.cards[c.id]?.misses ?? 0) > 0).length;
  const cats = mastery(bank, p);
  const learning = bank.filter((c) => inProgress(p.cards[c.id])).length;
  const learned = bank.filter((c) => p.cards[c.id]?.learned).length;
  const sessionSize = learning + due + (bank.length - seen);
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
          <Icon name="sparkle" /> {done ? 'Keep learning' : "Start today's bootcamp"}
        </button>
        <p className="muted small boot-sub">
          {learning} in progress · {due} reviews due · {learned.toLocaleString()} of {bank.length.toLocaleString()} facts learned · {(bank.length - seen).toLocaleString()} still new
        </p>
      </section>

      <div className="boot-modes">
        <button className="card boot-mode listen-mode" onClick={listen}>
          <span className="emoji">🎧</span>
          <strong>Listen</strong>
          <small>The product course, read aloud. Headphones in, walk the lot. {Object.keys(p.listened ?? {}).length} episodes finished</small>
        </button>
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
                  {c.mastered} learned · {c.seen} started · {c.total} facts
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
          <span className="soft small">Facts in rotation at once:</span>
          {[4, 6, 8, 10].map((n) => (
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
          You work on a few facts at a time. Miss one and it keeps coming back every few questions until you get it right {LEARN_RUN} times in a row; then it's learned and a new fact
          takes its place, so you're always moving forward. Learned facts come back later (2, 4, 7, 14, 30, 60 days) so they stick. New facts start as multiple choice; after two right in a
          row you type them from memory. Answer {DAILY_GOAL} a day to keep your streak.
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
  run: { mode: Mode; category?: string };
  onExit: () => void;
  onAgain: () => void;
}) {
  const speed = run.mode === 'speed';
  const today = dayOf();
  const live = useRef(p);
  live.current = p;
  // Learning modes: the 5-in-a-row loop. Speed: a fixed shuffled stack.
  const [trainer] = useState(() =>
    speed
      ? null
      : new Trainer(bank, () => live.current.cards, {
          today,
          size: Math.max(2, Math.min(12, p.newPerDay || 6)),
          focus: run.mode === 'daily' ? p.focus : undefined,
          filter: run.mode === 'category' ? (c) => c.cat === run.category : undefined,
          noNew: run.mode === 'weak',
          seed:
            run.mode === 'weak'
              ? bank
                  .filter((c) => (p.cards[c.id]?.misses ?? 0) > 0)
                  .sort((a, b) => p.cards[b.id].misses - p.cards[a.id].misses)
                  .slice(0, 15)
              : undefined,
        }),
  );
  const [stack] = useState(() => (speed ? buildSession('speed', bank, p, today) : []));
  const [card, setCard] = useState<Card | null>(() => (trainer ? trainer.next() : stack[0] ?? null));
  const [n, setN] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [xp, setXp] = useState(0);
  const [right, setRight] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [learnedNow, setLearnedNow] = useState(0);
  const [result, setResult] = useState<null | { ok: boolean; picked?: number | string; graduated?: boolean; run: number }>(null);
  const [typed, setTyped] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [endsAt] = useState(() => (speed ? Date.now() + 60_000 : 0));
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);

  const q: Question | null = useMemo(() => {
    if (!card) return null;
    const qq = questionFor(card, live.current.cards[card.id], bank);
    if (speed && qq.format !== 'choice') return questionFor(card, undefined, bank);
    return qq;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, n]);

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
    const { cards, ...stats } = live.current;
    const perfect = answered >= 10 && right === answered && !speed;
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
    if (result || !q || !card) return;
    const gained = points(q, ok, combo) + 0;
    const nextCombo = ok ? combo + 1 : 0;
    setCombo(nextCombo);
    setBestCombo((b) => Math.max(b, nextCombo));
    setAnswered((x) => x + 1);
    if (ok) setRight((x) => x + 1);
    const cur = live.current;
    const { cards, ...stats } = cur;
    const after = grade(cards[card.id], ok, today);
    const nextCards = speed ? cards : { ...cards, [card.id]: after };
    const graduated = trainer ? trainer.answered(card, ok, after).graduated : false;
    const bonus = graduated ? 30 : 0;
    setXp((x) => x + gained + bonus);
    if (graduated) setLearnedNow((x) => x + 1);
    const withDay = recordDay({ ...cur, cards: nextCards }, today, 1);
    const { cards: _x, ...nextStats } = withDay;
    save(nextCards, { ...nextStats, xp: stats.xp + gained + bonus, bestCombo: Math.max(stats.bestCombo, nextCombo) });
    setResult({ ok, picked, graduated, run: after.run ?? 0 });
    if (speed) setTimeout(next, ok ? 250 : 900);
  };

  const next = () => {
    setResult(null);
    setTyped('');
    setFlipped(false);
    setN((x) => x + 1);
    const c = trainer ? trainer.next() : stack[n + 1] ?? null;
    setCard(c);
    if (!c) finish();
  };

  // Keyboard: 1-4 to pick, Enter for next.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (finished || !q) return;
      if (result && !speed && (e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        next();
      } else if (!result && q.format === 'choice' && /^[1-4]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < q.options.length) answer(i === q.correct, i);
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  if (finished || !card || !q) {
    const lv = level(live.current.xp);
    const acc = answered ? Math.round((right / answered) * 100) : 0;
    const perfect = !speed && answered >= 10 && right === answered;
    return (
      <div className="page bootcamp">
        <section className="card boot-finish">
          <div className="big-emoji">{speed ? '⚡' : learnedNow ? '🎓' : perfect ? '🏆' : '💪'}</div>
          <div className="eyebrow">{speed ? 'SPEED ROUND OVER' : perfect ? 'PERFECT SESSION · +25 BONUS' : 'SESSION COMPLETE'}</div>
          <h1>+{xp} XP</h1>
          <p className="soft">
            {speed ? `${right} right in 60 seconds${right > p.speedBest ? ' · new best!' : ''}` : `${right} of ${answered} right (${acc}%)`}
            {!speed && ` · ${learnedNow} fact${learnedNow === 1 ? '' : 's'} learned`} · best combo {bestCombo}
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

  const st = live.current.cards[card.id];
  const runNow = result ? result.run : st?.run ?? 0;
  const isNew = !st && !speed;
  const isReview = !!st?.learned && !inProgress(st) && !speed;
  const doneToday = live.current.days[today] ?? 0;
  return (
    <div className="page bootcamp">
      <div className="boot-bar">
        <button className="btn ghost sm" onClick={() => (answered ? finish() : onExit())}>
          <Icon name="x" size={16} /> {answered ? 'End' : 'Exit'}
        </button>
        <div className="grow progress" title={speed ? 'Time' : `Today's goal: ${doneToday} / ${DAILY_GOAL}`}>
          <i style={{ width: `${speed ? ((60 - left) / 60) * 100 : Math.min(100, (doneToday / DAILY_GOAL) * 100)}%` }} />
        </div>
        {speed ? <span className="pill">⏱ {left}s</span> : <span className="pill" title="Learned this session">🎓 {learnedNow}</span>}
        <span className={`pill combo${combo >= 3 ? ' hot' : ''}`}>🔥 {combo}</span>
        <span className="pill xp">+{xp} XP</span>
      </div>

      <section className={`card boot-q${result ? (result.ok ? ' ok' : ' bad') : ''}`}>
        <div className="row between">
          <div className="eyebrow">
            {CAT_ICON[card.cat] ?? '📦'} {card.cat}
            {q.format === 'type' ? ' · TYPE IT' : q.format === 'versus' ? ' · HIGHER OR LOWER' : ''}
            {isNew ? ' · NEW' : isReview ? ' · REVIEW' : ''}
          </div>
          {!speed && (
            <div className="run-dots" title={`${runNow} of ${LEARN_RUN} right in a row`}>
              {Array.from({ length: LEARN_RUN }, (_, k) => (
                <i key={k} className={k < runNow ? 'on' : ''} />
              ))}
            </div>
          )}
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
            {q.options.map((o, i) => (
              <button
                key={o}
                disabled={!!result}
                className={`option${result ? (i === q.correct ? ' correct' : i === result.picked ? ' wrong' : '') : ''}`}
                onClick={() => answer(i === q.correct, i)}
              >
                <span className="key">{i + 1}</span> {o}
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
            <strong>
              {result.graduated
                ? `🎓 Learned! ${LEARN_RUN} in a row (+30 XP). A new fact joins the rotation.`
                : result.ok
                  ? `${pick(PRAISE, n)} ${result.run}/${LEARN_RUN} in a row.`
                  : `${pick(MISS, n)} It'll keep coming back until you get it ${LEARN_RUN} times in a row.`}
            </strong>
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
const MISS = ['Not this time.', 'Close, but no.', 'Not quite.', 'Lock this one in.'];
const pick = (xs: string[], n: number) => xs[n % xs.length];
