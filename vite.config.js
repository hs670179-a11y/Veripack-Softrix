import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Preview/dev-server config only.
// host + allowedHosts: the app is shown through a proxied sandbox preview host,
// so the dev server must accept non-localhost Host headers.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
