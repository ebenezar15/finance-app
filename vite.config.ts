import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode embed` produces one self-contained HTML file (JS, CSS and font inlined)
// for hosts that serve a single page, such as a shared Artifact link. No service worker there.
export default defineConfig(({ mode }) => {
  const embed = mode === 'embed';
  return {
  base: embed ? './' : '/',
  define: { 'import.meta.env.VITE_EMBED': JSON.stringify(embed ? '1' : '') },
  plugins: [
    react(),
    ...(embed ? [viteSingleFile()] : []),
    VitePWA({
      disable: embed,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Tandem — household money',
        short_name: 'Tandem',
        description: 'Offline-first personal and family finance',
        theme_color: '#0F4C5C',
        background_color: '#F3F4F1',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        shortcuts: [{ name: 'Add expense', url: '/?add=1' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'], navigateFallback: '/index.html' },
    }),
  ],
  build: embed
    ? { outDir: 'dist-embed', assetsInlineLimit: 100_000_000 }
    : { rollupOptions: { output: { manualChunks: { charts: ['recharts'], db: ['dexie', 'dexie-react-hooks'] } } } },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'], include: ['src/**/*.test.ts'] },
  } as any;
});
