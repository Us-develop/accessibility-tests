import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadAllAppEnv } from '../server/load-env.mjs';

const webDir = dirname(fileURLToPath(import.meta.url));
loadAllAppEnv(join(webDir, '..'));
if (!process.env.REPORTS_BASE?.trim()) {
  process.env.REPORTS_BASE = join(webDir, '..', 'reports');
}

const publicBaseRaw = String(process.env.PUBLIC_BASE_URL || 'https://wcag.about-us.be').trim().replace(/\/$/, '');
const site = /^https?:\/\//i.test(publicBaseRaw) ? publicBaseRaw : `https://${publicBaseRaw}`;

export default defineConfig({
  site,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  vite: {
    server: {
      proxy: {
        /**
         * Proxy to the API on 3456. changeOrigin + cookie rewrite avoids some 403s from strict backends
         * and keeps session cookies usable when the dev UI runs on another port.
         */
        '/api': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
        },
        '/report': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
        },
        '/auth': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
        },
        '/robots.txt': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
        },
        '/sitemap.xml': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
        },
      },
    },
  },
});
