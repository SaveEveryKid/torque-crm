/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dealer's website doesn't let other sites read its pages, so Torque CRM
 * asks this local server for them: /dealer/... is fetched from the dealer site
 * on your computer, the same as opening it in your browser. Read-only (GET).
 */
const DEALER = 'https://www.shoalsoutdoorsports.com';
const dealerProxy: Record<string, ProxyOptions> = {
  '/dealer': {
    target: DEALER,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/dealer/, ''),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    configure: (proxy) => {
      proxy.on('proxyReq', (req) => {
        if (req.method !== 'GET') req.destroy(new Error('Only GET is allowed to the dealer site.'));
        req.removeHeader('cookie');
        req.removeHeader('referer');
        req.removeHeader('origin');
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  // Always the same address: your data is saved per address (http://localhost:5180).
  server: { port: 5180, strictPort: true, proxy: dealerProxy },
  preview: { port: 5180, strictPort: true, proxy: dealerProxy },
  test: { environment: 'node' },
});
