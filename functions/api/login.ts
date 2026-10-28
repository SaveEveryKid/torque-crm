import { clearCookie, passwordOk, sessionCookie } from '../_lib/auth';
import { json, type Env } from '../_lib/env';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.APP_PASSWORD) return json(503, { error: 'Torque CRM has no password yet. Add APP_PASSWORD in Cloudflare (see the README).' });
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!(await passwordOk(env, String(body.password ?? '')))) {
    await new Promise((r) => setTimeout(r, 1200)); // slows down guessing
    return json(401, { error: 'Wrong password.' });
  }
  return json(200, { ok: true }, { 'Set-Cookie': await sessionCookie(env) });
};

export const onRequestDelete: PagesFunction<Env> = async () => json(200, { ok: true }, { 'Set-Cookie': clearCookie });
