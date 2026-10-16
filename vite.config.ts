import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ['recharts'], db: ['dexie', 'dexie-react-hooks'] } },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] },
} as any);
