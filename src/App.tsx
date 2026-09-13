import { lazy, Suspense, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from './features/auth/AuthContext'
import { AuthLoadingScreen, ProtectedRoute, PublicOnlyRoute } from './features/auth/RouteGuards'
import { youtubeChannelsQueryKey } from './features/youtube/channels'

const AuthPage = lazy(() => import('./features/auth/AuthPage').then((module) => ({ default: module.AuthPage })))
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const AuthCallbackPage = lazy(() => import('./features/auth/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })))
const DashboardPage = lazy(() => import('./features/publishing/PublishingWorkspace').then((module) => ({ default: module.DashboardPage })))

function DashboardRoute() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const displayName = user?.profile?.name?.trim() || user?.email || 'Account'
  const accountLabel = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const youtubeResult = searchParams.get('youtube')
  const youtubeReason = searchParams.get('reason')
  const youtubeNotice = youtubeResult === 'connected'
    ? { message: 'YouTube channel connected and ready for draft uploads.', tone: 'success' as const }
    : youtubeResult === 'error'
      ? { message: `YouTube authorization was not completed${youtubeReason ? `: ${youtubeReason.replaceAll('_', ' ')}` : '.'}`, tone: 'error' as const }
      : null

  useEffect(() => {
    if (!youtubeResult || !user?.id) return
    void queryClient.invalidateQueries({ queryKey: youtubeChannelsQueryKey(user.id) })
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('youtube')
    nextParams.delete('reason')
    setSearchParams(nextParams, { replace: true })
  }, [queryClient, searchParams, setSearchParams, user?.id, youtubeResult])

  async function handleSignOut() {
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  return <DashboardPage accountEmail={user?.email ?? ''} accountLabel={accountLabel} initialNotice={youtubeNotice} onSignOut={handleSignOut} userId={user?.id ?? ''} />
}

function App() {
  const location = useLocation()

  return (
    <>
      {location.pathname === '/app' ? (
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-brand-ink"
          href="#release-ledger-panel"
        >
          Skip to release ledger
        </a>
      ) : null}
      <Suspense fallback={<AuthLoadingScreen />}>
        <Routes>
          <Route element={<Navigate replace to="/app" />} path="/" />
          <Route element={<PublicOnlyRoute><AuthPage /></PublicOnlyRoute>} path="/sign-in" />
          <Route element={<PublicOnlyRoute><ResetPasswordPage /></PublicOnlyRoute>} path="/reset-password" />
          <Route element={<AuthCallbackPage />} path="/auth/callback" />
          <Route element={<ProtectedRoute><DashboardRoute /></ProtectedRoute>} path="/app" />
          <Route element={<NotFound />} path="*" />
        </Routes>
      </Suspense>
    </>
  )
}

function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-app px-4 py-10">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-md overflow-hidden rounded-[12px] border border-border bg-surface"
      >
        <div className="border-b border-border px-5 py-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">404 / No such release view</p>
          <h1 className="mt-1.5 text-[20px] font-medium tracking-[-0.025em] text-ink" id="not-found-title">
            This workspace view does not exist
          </h1>
        </div>
        <p className="px-5 py-4 text-[13px] leading-6 text-muted">
          Check the address or return to the release desk. Your drafts are unchanged.
        </p>
        <div className="flex justify-end border-t border-border px-5 py-4">
          <Link className="button-primary" to="/app">
            Return to release desk
          </Link>
        </div>
      </section>
    </div>
  )
}

export default App
