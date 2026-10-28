import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthError, kv } from './core/storage/kv';
import { loadStatus } from './crm/server';
import { App } from './App';
import { Login } from './ui/Login';
import './styles.css';

type Phase = { kind: 'loading' } | { kind: 'in' } | { kind: 'login'; setup: boolean; message: string } | { kind: 'error'; message: string };

/** Load your data from Cloudflare, or ask for the password first. */
function Root() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const start = () => {
    setPhase({ kind: 'loading' });
    Promise.all([kv.ready(), loadStatus()])
      .then(() => setPhase({ kind: 'in' }))
      .catch((e: Error) => setPhase(e instanceof AuthError ? { kind: 'login', setup: e.setup, message: e.message } : { kind: 'error', message: e.message }));
  };
  useEffect(start, []);
  if (phase.kind === 'in') return <App />;
  if (phase.kind === 'login') return <Login setup={phase.setup} message={phase.message} onIn={start} />;
  return (
    <div className="login">
      <div className="card">
        {phase.kind === 'loading' ? (
          <p className="muted">Loading your customers…</p>
        ) : (
          <>
            <p className="error">Couldn't load your data: {phase.message}</p>
            <button className="btn" onClick={start}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
