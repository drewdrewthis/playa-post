import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * PWA-ready by construction: the product must work offline (addendum §14), so the
 * service worker exists from the first commit rather than being retrofitted once
 * caching assumptions have already hardened.
 *
 * `registerType: 'autoUpdate'` is deliberate — a community app should not ask a
 * user to approve an update; the offline store is versioned separately (M4).
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        id: '/',
        name: 'Playa Post',
        short_name: 'Playa Post',
        description: 'A private, opt-in community trust network.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
