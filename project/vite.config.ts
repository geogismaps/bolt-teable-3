import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: 'public',
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 5000
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})