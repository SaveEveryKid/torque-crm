import { useState } from 'react';
import { login } from '../core/storage/kv';

/** The password screen (or what's still missing on Cloudflare). */
export function Login({ setup, message, onIn }: { setup: boolean; message: string; onIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="brand">
          <img src="/torque-icon.png" alt="" />
          <div>Torque CRM</div>
        </div>
        {setup ? (
          <p className="notice">{message}</p>
        ) : (
          <>
            <label className="field">
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Log in'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
