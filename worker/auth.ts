import type { Env } from './env';

/**
 * LOGIN: one password (APP_PASSWORD). A correct password gets a signed cookie
 * good for 30 days; changing the password logs every device out.
 */
const COOKIE = 'tcrm';
const DAYS = 30;
const enc = new TextEncoder();

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`torque-crm:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Compare without stopping at the first different character. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function sessionCookie(env: Env, now = Date.now()): Promise<string> {
  const exp = String(now + DAYS * 86_400_000);
  return `${COOKIE}=${exp}.${await sign(env.APP_PASSWORD!, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DAYS * 86_400}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function loggedIn(request: Request, env: Env, now = Date.now()): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  const raw = request.headers.get('Cookie') ?? '';
  const v = raw
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [exp, sig] = (v ?? '').split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return same(sig, await sign(env.APP_PASSWORD, exp));
}

export async function passwordOk(env: Env, password: string): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  // Compare signatures, so the comparison takes the same time whatever was typed.
  return same(await sign(env.APP_PASSWORD, `pw:${password}`), await sign(env.APP_PASSWORD, `pw:${env.APP_PASSWORD}`));
}
