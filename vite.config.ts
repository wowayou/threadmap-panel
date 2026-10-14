import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  build: { outDir: 'dist/demo', emptyOutDir: true, rollupOptions: { input: resolve(__dirname, 'index.html') } }
})
