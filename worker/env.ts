/** Torque CRM's Worker settings: the DB and ASSETS bindings (wrangler.jsonc) and your secrets (Settings → Variables and Secrets). */
export interface Env {
  /** D1 database binding: where your customers and history are kept. */
  DB: D1Database;
  /** The app's pages (dist/). */
  ASSETS: Fetcher;
  /** The password you log in with (a secret). */
  APP_PASSWORD?: string;
  /** Your Torque dialer (the Cloudflare Worker), e.g. https://torque-dialer.yourname.workers.dev */
  DIALER_URL?: string;
  /** The dialer password (a secret). Stays on Cloudflare: the browser never sees it. */
  DIALER_PASSWORD?: string;
  /** Texting through SignalWire: your space (e.g. byrongreen.signalwire.com), project ID, API token (a secret) and the number you text from (+1…). */
  SW_SPACE?: string;
  SW_PROJECT_ID?: string;
  SW_API_TOKEN?: string;
  SMS_FROM?: string;
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
