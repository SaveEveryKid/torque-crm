import { json, type Env } from '../../_lib/env';

/**
 * YOUR DIALER, through Torque CRM: the browser posts here, and this adds the
 * dialer password (a Cloudflare secret) and passes the request to your
 * dialer's /api (calls) or /draft (Claude). Nothing else is reachable.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const path = `/${([] as string[]).concat(params.path ?? []).join('/')}`;
  if (path !== '/api' && path !== '/draft') return json(404, { error: 'Not found.' });
  if (!env.DIALER_URL || !env.DIALER_PASSWORD) return json(503, { error: 'The dialer isn’t set up yet. Add DIALER_URL and DIALER_PASSWORD in Cloudflare (see the README).' });
  const form = new URLSearchParams(await request.text());
  form.set('token', env.DIALER_PASSWORD);
  const res = await fetch(new URL(path, env.DIALER_URL).toString(), { method: 'POST', body: form });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' } });
};
