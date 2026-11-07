import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { channelFor } from './src/lib/buildChannel'

// https://vitejs.dev/config/
// The dev server and development-mode builds get the "Dev" tag; a production build is a release.
export default defineConfig(({ command, mode }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __ORBIT_CHANNEL__: JSON.stringify(channelFor(command, mode)),
  },
  server: {
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          wails: ['@wailsio/runtime'],
        },
      },
    },
  },
}))
