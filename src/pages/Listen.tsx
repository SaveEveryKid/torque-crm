import { useEffect, useRef, useState } from 'react';
import { download } from '../crm/backup';
import { Icon } from '../ui/kit';

/**
 * LISTEN: the product course read aloud (the device's own voice), for
 * headphones on the lot. Episodes by product line; quiz questions pause so
 * you can answer in your head before you hear it.
 */
interface Segment {
  t: string;
  h?: boolean;
  pause?: number;
}
interface Episode {
  id: string;
  title: string;
  minutes: number;
  segments: Segment[];
}

/** Short pieces: some browsers stop long speech after ~15 seconds. */
const sentences = (t: string) => t.match(/[^.?!]+[.?!]+["”]?|\S[^.?!]*$/g)?.map((x) => x.trim()).filter(Boolean) ?? [t];

export function scriptText(ep: Episode): string {
  return [ep.title.toUpperCase(), '', ...ep.segments.map((s) => (s.h ? `\n${s.t.toUpperCase()}` : s.pause ? `${s.t}  (pause)` : s.t))].join('\n');
}

export function Listen({ listened, onListened, onBack }: { listened: Record<string, string>; onListened: (id: string) => void; onBack: () => void }) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [ep, setEp] = useState(0);
  const [seg, setSeg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(() => Number(localStorage.getItem('listenRate') ?? 1) || 1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('listenVoice') ?? '');
  const [autoNext, setAutoNext] = useState(true);
  const run = useRef(0); // bumps on every stop/skip so old callbacks do nothing
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    void import('../training/audio.json').then((m) => setEpisodes((m.default as { episodes: Episode[] }).episodes));
  }, []);
  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load);
      speechSynthesis.cancel();
    };
  }, [supported]);

  const voice = voices.find((v) => v.name === voiceName) ?? voices.find((v) => /natural|neural|premium|enhanced/i.test(v.name) && v.lang === 'en-US') ?? voices.find((v) => v.lang === 'en-US');

  const stop = () => {
    run.current++;
    if (supported) speechSynthesis.cancel();
    setPlaying(false);
    void lock.current?.release().catch(() => undefined);
    lock.current = null;
  };

  /** Speak episode e from segment s onward. */
  const play = (e: number, s: number) => {
    if (!episodes || !supported) return;
    stop();
    const my = ++run.current;
    setEp(e);
    setSeg(s);
    setPlaying(true);
    // Keep the screen (and so the speech) going on phones.
    void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock.current = l))
      .catch(() => undefined);
    const episode = episodes[e];
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: episode.title, artist: 'Torque product training' });
      navigator.mediaSession.setActionHandler('pause', () => stop());
      navigator.mediaSession.setActionHandler('play', () => play(e, s));
      navigator.mediaSession.setActionHandler('nexttrack', () => e + 1 < episodes.length && play(e + 1, 0));
      navigator.mediaSession.setActionHandler('previoustrack', () => play(e, 0));
    }
    const say = (i: number) => {
      if (run.current !== my) return;
      if (i >= episode.segments.length) {
        onListened(episode.id);
        if (autoNext && e + 1 < episodes.length) setTimeout(() => run.current === my && play(e + 1, 0), 1500);
        else stop();
        return;
      }
      setSeg(i);
      const part = episode.segments[i];
      const pieces = sentences(part.t);
      const speakPiece = (k: number) => {
        if (run.current !== my) return;
        if (k >= pieces.length) {
          setTimeout(() => say(i + 1), (part.pause ?? (part.h ? 0.6 : 0.35)) * 1000);
          return;
        }
        const u = new SpeechSynthesisUtterance(pieces[k]);
        u.rate = rate;
        if (voice) u.voice = voice;
        u.onend = () => speakPiece(k + 1);
        u.onerror = () => speakPiece(k + 1);
        speechSynthesis.speak(u);
      };
      speakPiece(0);
    };
    say(s);
  };

  if (!episodes) return <div className="page"><p className="muted">Loading the course…</p></div>;
  const current = episodes[ep];
  const total = episodes.reduce((n, x) => n + x.minutes, 0);
  const done = episodes.filter((x) => listened[x.id]).length;

  return (
    <div className="page bootcamp">
      <div className="row">
        <button className="btn ghost sm" onClick={() => (stop(), onBack())}>
          <Icon name="back" size={16} /> Bootcamp
        </button>
      </div>
      <section className="card boot-hero listen-hero">
        <div>
          <div className="eyebrow">🎧 LISTEN · {episodes.length} EPISODES · ABOUT {total} MINUTES</div>
          <h1>{current.title}</h1>
          <p className="soft">
            Episode {ep + 1} of {episodes.length} · {current.minutes} min · {done} of {episodes.length} finished
          </p>
        </div>
        {!supported ? (
          <p className="notice">This browser can't read aloud. Download the script below and use your phone's read-aloud app.</p>
        ) : (
          <div className="listen-controls">
            <button className="btn icon-lg" title="Back a part" onClick={() => play(ep, Math.max(0, seg - 1))}>
              ⏮
            </button>
            {playing ? (
              <button className="btn primary icon-xl" title="Pause" onClick={stop}>
                ⏸
              </button>
            ) : (
              <button className="btn primary icon-xl" title="Play" onClick={() => play(ep, seg)}>
                ▶
              </button>
            )}
            <button className="btn icon-lg" title="Skip a part" onClick={() => play(ep, Math.min(current.segments.length - 1, seg + 1))}>
              ⏭
            </button>
          </div>
        )}
        <div className="now-reading">{current.segments[seg]?.t}</div>
        <div className="progress">
          <i style={{ width: `${(seg / Math.max(1, current.segments.length - 1)) * 100}%` }} />
        </div>
        <div className="row listen-opts">
          <span className="soft small">Speed</span>
          {[0.85, 1, 1.15, 1.3, 1.5].map((r) => (
            <button
              key={r}
              className={`chip${rate === r ? ' on' : ''}`}
              onClick={() => {
                setRate(r);
                try {
                  localStorage.setItem('listenRate', String(r));
                } catch {
                  /* private mode */
                }
                if (playing) setTimeout(() => play(ep, seg), 0);
              }}
            >
              {r}×
            </button>
          ))}
          {voices.length > 1 && (
            <select
              value={voice?.name ?? ''}
              onChange={(e) => {
                setVoiceName(e.target.value);
                try {
                  localStorage.setItem('listenVoice', e.target.value);
                } catch {
                  /* private mode */
                }
              }}
              aria-label="Voice"
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          <label className="check small">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} /> Play the next episode
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Episodes</h2>
          <button className="btn sm" onClick={() => download('torque-product-course.txt', episodes.map(scriptText).join('\n\n\n'), 'text/plain')}>
            <Icon name="download" size={14} /> Download the whole script
          </button>
        </div>
        <div className="list">
          {episodes.map((x, i) => (
            <div key={x.id} className={`list-item click${i === ep ? ' on-ep' : ''}`} onClick={() => play(i, 0)}>
              <span className="ep-num">{listened[x.id] ? '✓' : i + 1}</span>
              <div className="grow">
                <div className="title">{x.title}</div>
                <div className="muted small">
                  {x.minutes} min{listened[x.id] ? ` · finished ${new Date(listened[x.id]).toLocaleDateString()}` : ''}
                </div>
              </div>
              <button
                className="btn ghost sm"
                title="Download this episode's script"
                onClick={(e) => {
                  e.stopPropagation();
                  download(`torque-${x.id}.txt`, scriptText(x), 'text/plain');
                }}
              >
                <Icon name="download" size={14} />
              </button>
              <span className="muted">▶</span>
            </div>
          ))}
        </div>
      </section>
      <p className="muted small">
        Tip: keep the screen on while listening (phones pause the voice when the screen locks). For listening with the screen off, download the script and play it in a read-aloud app (iPhone:
        Settings → Accessibility → Spoken Content → Speak Screen; Android: Select to Speak, or apps like Speechify or ElevenReader).
      </p>
    </div>
  );
}
