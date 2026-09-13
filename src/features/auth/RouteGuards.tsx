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
          <p className="technical-label">QueuePilot / session</p>
          <div className="mt-4 h-8 w-52 animate-pulse bg-surface-subtle" />
          <div className="mt-10 h-12 animate-pulse border border-border bg-surface" />
          <p className="mt-5 text-[13px] text-muted">Restoring your secure session...</p>
        </div>
      </div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <AuthLoadingScreen />
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location }} />

  return children
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return <AuthLoadingScreen />
  if (user) return <Navigate to="/app" replace />

  return children
}
