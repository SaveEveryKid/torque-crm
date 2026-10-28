import { loggedIn } from '../_lib/auth';
import { json, type Env } from '../_lib/env';

/**
 * INVENTORY: the dealer's website doesn't let other sites read its pages, so
 * Torque CRM reads them here (GET only, the dealer's site only) and hands the
 * page to your browser. Cached for 15 minutes.
 */
const DEALER = 'https://www.shoalsoutdoorsports.com';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!(await loggedIn(request, env))) return json(401, { error: 'Please log in.' });
  const path = `/${([] as string[]).concat(params.path ?? []).join('/')}`;
  if (!/^\/Inventory\/[\w-]+$/.test(path)) return json(404, { error: 'Only inventory pages.' });
  const res = await fetch(`${DEALER}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
};
