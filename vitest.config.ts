import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Forks are more reliable than worker_threads with the current Windows
    // toolchain; the thread pool can stall before test collection.
    pool: 'forks',
    maxWorkers: 1,
    setupFiles: './src/test/setup.ts',
  },
})
