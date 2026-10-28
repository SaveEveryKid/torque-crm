import { json, type Env } from '../_lib/env';

/** What's set up on Cloudflare (never the secrets themselves). */
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json(200, { dialer: Boolean(env.DIALER_URL && env.DIALER_PASSWORD), dialerUrl: env.DIALER_URL ?? null, database: Boolean(env.DB) });
