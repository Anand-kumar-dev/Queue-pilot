import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              priority: 30,
              test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom|@tanstack)[\\/]/,
            },
            {
              maxSize: 350_000,
              name: 'insforge-vendor',
              priority: 20,
              test: /node_modules[\\/](?:@insforge|@supabase|socket\.io-client|engine\.io-client)[\\/]/,
            },
            {
              name: 'icons-vendor',
              priority: 10,
              test: /node_modules[\\/]lucide-react[\\/]/,
            },
            {
              maxSize: 350_000,
              name: 'vendor',
              priority: 1,
              test: /node_modules[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [react()],
})
