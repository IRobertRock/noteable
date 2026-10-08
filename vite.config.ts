/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the app from https://irobertrock.github.io/noteable/
const base = '/noteable/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // Phase 2 speed test; open /noteable/spikes/kokoro-mp3.html on each device.
        spike: 'spikes/kokoro-mp3.html',
        // End-to-end generation test against an in-memory Drive.
        pipeline: 'spikes/pipeline.html',
      },
    },
  },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Noteable',
        short_name: 'Noteable',
        description: 'Personal audiobook and study-guide maker',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Google, Drive and Hugging Face requests are never cached here.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // The TTS engine is large and only needed when generating; it is cached on first use instead.
        globIgnores: ['spikes/**', 'assets/spike-*', 'assets/pipeline-*', 'assets/tts.worker-*', 'assets/*.wasm'],
        navigateFallback: `${base}index.html`,
        // The test pages are real pages, not app routes.
        navigateFallbackDenylist: [/\/spikes\//],
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: 'happy-dom',
    // The app uses mammoth's browser build (it takes an ArrayBuffer); test the same one.
    alias: { mammoth: 'mammoth/mammoth.browser.js' },
    include: ['test/**/*.test.ts'],
  },
});
