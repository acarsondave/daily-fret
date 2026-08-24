import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The app has to open with no connection. Everything the routine depends on
    // already survives a disconnection (Zustand persists to localStorage,
    // diagnostics to IndexedDB, footage to OPFS, Firebase Auth to its own store)
    // but the page hosting all of it was still fetched from the network on every
    // cold load, so a practice session with no signal began with a browser error.
    VitePWA({
      // Never swap the running app underneath a session in progress. A new build
      // waits, the header says so, and the reload is the player's own tap.
      registerType: 'prompt',
      // Registration happens through virtual:pwa-register/react so the waiting
      // build has somewhere to be announced.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons.svg', 'app-icon-192.png', 'app-icon-512.png'],
      manifest: {
        name: 'Daily Fret',
        short_name: 'Daily Fret',
        description: 'Your guitar practice, run end to end.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0F0F11',
        theme_color: '#0F0F11',
        icons: [
          { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The whole shell, hashed by the build, so an update lands atomically.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Sixty-odd voice clips. Precaching them would spend the owner's mobile
        // data on the first load of every deploy fetching audio he may not hear
        // that day; they are runtime-cached below instead, so a line he has
        // heard once is a line he owns.
        globIgnores: ['**/coach/**'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/coach/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'coach-voice',
              // The pack is fixed and small; the manifest names every clip.
              expiration: { maxEntries: 200 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Firestore, Firebase Auth and YouTube are deliberately absent from this
        // list. Firestore has its own offline machinery and a service worker in
        // front of it is a way to serve stale user data back to its owner; the
        // YouTube embed is cross-origin and opaque, and its terms are clear that
        // the player is not a media source to be kept.
      },
    }),
  ],
  build: {
    // Without an explicit CSS target the minifier collapsed every
    // `backdrop-filter` / `-webkit-backdrop-filter` pair down to the prefixed
    // one alone. Chromium and Firefox do not support the prefixed form at all,
    // so seven of the app's nine glass surfaces — including the full-screen
    // practice overlay — rendered with no blur on every browser except Safari.
    // Naming the targets makes the toolchain own the prefixing instead.
    cssTarget: ['chrome111', 'edge111', 'firefox113', 'safari16.4'],
  },
})
