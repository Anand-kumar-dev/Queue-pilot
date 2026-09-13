import { createClient } from '@insforge/sdk'

const baseUrl = import.meta.env.VITE_INSFORGE_URL
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY

if (!baseUrl || !anonKey) {
  throw new Error(
    'Missing InsForge browser configuration. Copy .env.example to .env.local and fill in the public values.',
  )
}

// The browser client keeps its refresh session in an httpOnly cookie. On a
// cold load, AuthProvider calls getCurrentUser() to restore that session before
// routes render, so users stay signed in until they sign out or it expires.
export const insforge = createClient({ baseUrl, anonKey })
