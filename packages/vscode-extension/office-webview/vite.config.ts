import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/office-webview',
    emptyOutDir: true,
  },
  base: './',
})
