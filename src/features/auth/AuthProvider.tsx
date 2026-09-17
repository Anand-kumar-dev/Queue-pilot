import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UserSchema } from '@insforge/sdk'
import { useQueryClient } from '@tanstack/react-query'
import { insforge } from '../../lib/insforge'
import { AuthContext, type AuthContextValue, type AuthStatus, type PublicAuthConfig } from './AuthContext'
import { isAuthenticationFailure, sessionRecoveryMessage } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const currentUserId = useRef<string | null>(null)
  const currentUser = useRef<UserSchema | null>(null)
  const [user, setUser] = useState<UserSchema | null>(null)
  const [status, setStatus] = useState<AuthStatus>('booting')
  const [sessionRefreshing, setSessionRefreshing] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [config, setConfig] = useState<PublicAuthConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  const commitUser = useCallback((nextUser: UserSchema | null) => {
    if (currentUserId.current && currentUserId.current !== nextUser?.id) {
      queryClient.clear()
    }
    currentUserId.current = nextUser?.id ?? null
    currentUser.current = nextUser
    setUser(nextUser)
  }, [queryClient])

  const refreshUser = useCallback(async () => {
    setSessionRefreshing(true)
    if (!currentUser.current) setStatus('booting')

    try {
      const { data, error } = await insforge.auth.getCurrentUser()

      if (error) {
        if (isAuthenticationFailure(error)) {
          commitUser(null)
          setSessionError(null)
          setStatus('anonymous')
          return null
        }

        setSessionError(sessionRecoveryMessage(error))
        setStatus('degraded')
        return currentUser.current
      }

      const nextUser = data.user ?? null
      commitUser(nextUser)
      setSessionError(null)
      setStatus(nextUser ? 'authenticated' : 'anonymous')
      return nextUser
    } finally {
      setSessionRefreshing(false)
    }
  }, [commitUser])

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const [userResult, configResult] = await Promise.all([
        insforge.auth.getCurrentUser(),
        insforge.auth.getPublicAuthConfig(),
      ])

      if (cancelled) return

      if (userResult.error) {
        if (isAuthenticationFailure(userResult.error)) {
          commitUser(null)
          setStatus('anonymous')
        } else {
          setSessionError(sessionRecoveryMessage(userResult.error))
          setStatus('degraded')
        }
      } else {
        const nextUser = userResult.data.user ?? null
        commitUser(nextUser)
        setStatus(nextUser ? 'authenticated' : 'anonymous')
      }
      setSessionRefreshing(false)
      setConfig(configResult.error ? null : configResult.data)
      setConfigError(configResult.error?.message ?? null)
      setConfigLoading(false)
    }

    const unsubscribe = insforge.auth.onAuthStateChange((event) => {
      if (event === 'signedOut') {
        commitUser(null)
        setSessionError(null)
        setStatus('anonymous')
        setSessionRefreshing(false)
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
      status,
      loading: status === 'booting',
      sessionRefreshing,
      sessionError,
      config,
      configLoading,
      configError,
      refreshUser,
      retrySession: refreshUser,
      signOut: async () => {
        const { error } = await insforge.auth.signOut()
        if (error) throw error
        commitUser(null)
        setSessionError(null)
        setStatus('anonymous')
      },
    }),
    [commitUser, config, configError, configLoading, refreshUser, sessionError, sessionRefreshing, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
