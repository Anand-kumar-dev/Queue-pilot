import { createContext, useContext } from 'react'
import type { UserSchema } from '@insforge/sdk'
import { insforge } from '../../lib/insforge'

type AuthConfigResult = Awaited<ReturnType<typeof insforge.auth.getPublicAuthConfig>>
export type PublicAuthConfig = NonNullable<AuthConfigResult['data']>
export type AuthStatus = 'booting' | 'authenticated' | 'anonymous' | 'degraded'

export interface AuthContextValue {
  user: UserSchema | null
  status: AuthStatus
  loading: boolean
  sessionRefreshing: boolean
  sessionError: string | null
  config: PublicAuthConfig | null
  configLoading: boolean
  configError: string | null
  refreshUser: () => Promise<UserSchema | null>
  retrySession: () => Promise<UserSchema | null>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return value
}
