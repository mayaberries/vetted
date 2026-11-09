import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

import vue from '@astrojs/vue';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  // Astro marks the session cookie Secure in production builds, and WebKit drops
  // Secure cookies on plain-http localhost (Chromium and Firefox don't), so the
  // Playwright suite -- which serves a production build over http -- could never
  // sign in under webkit. Only playwright.config.ts sets this; it's read at build
  // time, so a deployed build keeps Astro's default.
  ...(process.env.ADMIN_INSECURE_SESSION_COOKIE === '1' && {
    session: { cookie: { secure: false } },
  }),

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [vue()],
});