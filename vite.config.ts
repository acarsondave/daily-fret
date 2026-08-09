import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
