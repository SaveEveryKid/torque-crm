import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { kv } from './core/storage/kv';
import { App } from './App';
import './styles.css';

// Ask the browser to keep this data even when disk space runs low.
void navigator.storage?.persist?.();

kv.ready().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
