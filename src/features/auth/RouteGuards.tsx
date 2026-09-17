import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen bg-workspace" role="status">
      <div className="hidden w-56 shrink-0 bg-rail lg:block" />
      <div className="flex-1">
        <div className="h-14 border-b border-border bg-surface" />
        <div className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8">
          <div className="h-8 w-52 animate-pulse rounded-full bg-surface-subtle" />
          <div className="mt-10 h-12 animate-pulse border border-border bg-surface" />
          <p className="mt-5 text-[13px] text-muted">Restoring your secure session...</p>
        </div>
      </div>
    </div>
  )
}

export function AuthRecoveryScreen() {
  const { retrySession, sessionError, sessionRefreshing } = useAuth()

  return (
    <div className="grid min-h-screen place-items-center bg-app px-5 py-10">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-ink shadow-dialog" role="alert">
        <span className="grid size-10 place-items-center rounded-full bg-status-warning-bg text-status-warning">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.03em]">Your session is temporarily unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {sessionError ?? 'Queue Pilot could not verify your session. Your account has not been signed out.'}
        </p>
        <button className="button-primary mt-6" disabled={sessionRefreshing} onClick={() => void retrySession()} type="button">
          <RefreshCw className={`size-4 ${sessionRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {sessionRefreshing ? 'Checking session...' : 'Retry session'}
        </button>
      </section>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'booting') return <AuthLoadingScreen />
  if (status === 'degraded' && !user) return <AuthRecoveryScreen />
  if (status === 'anonymous') return <Navigate to="/sign-in" replace state={{ from: location }} />
  if (!user) return <AuthRecoveryScreen />

  return children
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()

  if (status === 'booting') return <AuthLoadingScreen />
  if (status === 'degraded' && !user) return <AuthRecoveryScreen />
  if (user) return <Navigate to="/app" replace />

  return children
}
