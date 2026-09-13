import { createClient } from '@insforge/sdk'

const baseUrl = import.meta.env.VITE_INSFORGE_URL
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY

if (!baseUrl || !anonKey) {
  throw new Error(
    'Missing InsForge browser configuration. Copy .env.example to .env.local and fill in the public values.',
  )
}

export const insforge = createClient({ baseUrl, anonKey })
