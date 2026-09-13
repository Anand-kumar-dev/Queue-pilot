import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthContext'
import { AUTH_RETURN_TO_KEY, getSafeReturnTo } from './redirects'

export function AuthCallbackPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [settledWithoutUser, setSettledWithoutUser] = useState(false)
  const callbackError = searchParams.get('insforge_error')

  useEffect(() => {
    if (loading || callbackError) return

    if (user) {
      const returnTo = getSafeReturnTo(sessionStorage.getItem(AUTH_RETURN_TO_KEY))
      sessionStorage.removeItem(AUTH_RETURN_TO_KEY)
      navigate(returnTo, { replace: true })
      return
    }

    sessionStorage.removeItem(AUTH_RETURN_TO_KEY)
    setSettledWithoutUser(true)
  }, [callbackError, loading, navigate, user])

  return (
    <AuthLayout>
      {callbackError || settledWithoutUser ? (
        <div>
          <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-ink">Sign-in could not be completed</h2>
          <p className="notice-danger mt-6" role="alert">{callbackError ?? 'No authenticated session was returned. Please try signing in again.'}</p>
          <Link className="button-primary mt-7 h-11 w-full" to="/sign-in">Return to sign in</Link>
        </div>
      ) : (
        <div role="status">
          <LoaderCircle className="mt-6 size-5 animate-spin text-brand" aria-hidden="true" />
          <h2 className="mt-5 text-[26px] font-medium tracking-[-0.03em] text-ink">Restoring your session</h2>
          <p className="mt-2 text-sm text-muted">The application will continue when authentication is complete.</p>
        </div>
      )}
    </AuthLayout>
  )
}
