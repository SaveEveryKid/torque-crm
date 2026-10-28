import { loggedIn } from '../_lib/auth';
import { json, type Env } from '../_lib/env';

/** Every /api route except login needs you to be logged in. */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const path = new URL(ctx.request.url).pathname;
  if (path === '/api/login') return ctx.next();
  if (!ctx.env.APP_PASSWORD) return json(503, { error: 'Torque CRM has no password yet. Add APP_PASSWORD in Cloudflare (see the README).', setup: true });
  if (!(await loggedIn(ctx.request, ctx.env))) return json(401, { error: 'Please log in.' });
  return ctx.next();
};
