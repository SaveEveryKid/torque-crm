import { useEffect, useState } from 'react';

/**
 * The app stays open all day, so it doesn't pick up new versions by itself.
 * Every few minutes (and when you come back to the tab) it checks whether a
 * new version is live and offers a reload.
 */
const current = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? null;

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = current();
    if (!mine) return; // local development
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const live = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1];
        if (live && live !== mine) setStale(true);
      } catch {
        /* offline: try again later */
      }
    };
    const t = setInterval(check, 5 * 60_000);
    const onShow = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onShow);
    void check();
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);
  if (!stale) return null;
  return (
    <button className="update-banner" onClick={() => location.reload()}>
      ✨ Torque CRM was updated. <b>Reload</b>
    </button>
  );
}
