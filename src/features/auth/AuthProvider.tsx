import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UserSchema } from '@insforge/sdk'
import { useQueryClient } from '@tanstack/react-query'
import { insforge } from '../../lib/insforge'
import { AuthContext, type AuthContextValue, type PublicAuthConfig } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const currentUserId = useRef<string | null>(null)
  const [user, setUser] = useState<UserSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<PublicAuthConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  const commitUser = useCallback((nextUser: UserSchema | null) => {
    if (currentUserId.current && currentUserId.current !== nextUser?.id) {
      queryClient.clear()
    }
    currentUserId.current = nextUser?.id ?? null
    setUser(nextUser)
  }, [queryClient])

  const refreshUser = useCallback(async () => {
    const { data, error } = await insforge.auth.getCurrentUser()
    const nextUser = error ? null : (data.user ?? null)
    commitUser(nextUser)
    setLoading(false)
    return nextUser
  }, [commitUser])

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const [userResult, configResult] = await Promise.all([
        insforge.auth.getCurrentUser(),
        insforge.auth.getPublicAuthConfig(),
      ])

      if (cancelled) return

      commitUser(userResult.error ? null : (userResult.data.user ?? null))
      setLoading(false)
      setConfig(configResult.error ? null : configResult.data)
      setConfigError(configResult.error?.message ?? null)
      setConfigLoading(false)
    }

    const unsubscribe = insforge.auth.onAuthStateChange((event) => {
      if (event === 'signedOut') {
        commitUser(null)
        setLoading(false)
        return
      }

      void refreshUser()
    })

    void hydrate()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [commitUser, refreshUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      config,
      configLoading,
      configError,
      refreshUser,
      signOut: async () => {
        const { error } = await insforge.auth.signOut()
        if (error) throw error
        commitUser(null)
      },
    }),
    [commitUser, config, configError, configLoading, loading, refreshUser, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
