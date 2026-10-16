import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode embed` produces one self-contained HTML file (JS, CSS and font inlined)
// for hosts that serve a single page, such as a shared Artifact link. No service worker there.
export default defineConfig(({ mode }) => {
  const embed = mode === 'embed';
  return {
  base: embed ? './' : process.env.BASE_PATH ?? '/',
  define: { 'import.meta.env.VITE_EMBED': JSON.stringify(embed ? '1' : '') },
  plugins: [
    react(),
    ...(embed ? [viteSingleFile()] : []),
    VitePWA({
      disable: embed,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tandem — household money',
        short_name: 'Tandem',
        description: 'Offline-first personal and family finance',
        theme_color: '#0F4C5C',
        background_color: '#F3F4F1',
        display: 'standalone',
        id: './',
        start_url: './',
        scope: './',
        display_override: ['standalone', 'minimal-ui'],
        prefer_related_applications: false,
        lang: 'en',
        dir: 'ltr',
        orientation: 'portrait',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [{ name: 'Add expense', short_name: 'Add', url: './?add=1', icons: [{ src: 'icon-192.png', sizes: '192x192' }] }],
      },
      workbox: { clientsClaim: true, skipWaiting: true, cleanupOutdatedCaches: true, globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'], navigateFallback: 'index.html' },
    }),
  ],
  build: embed
    ? { outDir: 'dist-embed', assetsInlineLimit: 100_000_000 }
    : { rollupOptions: { output: { manualChunks: { charts: ['recharts'], db: ['dexie', 'dexie-react-hooks'] } } } },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'], include: ['src/**/*.test.ts'] },
  } as any;
});
