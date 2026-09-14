import { useState, type FormEvent } from 'react'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { insforge } from '../../lib/insforge'
import { toUserErrorMessage } from '../../lib/errors'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthContext'
import { AUTH_RETURN_TO_KEY, getSafeReturnTo } from './redirects'

type AuthMode = 'sign-in' | 'sign-up'

interface LocationState {
  from?: {
    pathname?: string
    search?: string
  }
}

function getReturnTo(state: unknown) {
  const locationState = state as LocationState | null
  const pathname = locationState?.from?.pathname
  const search = locationState?.from?.search ?? ''
  return getSafeReturnTo(pathname ? `${pathname}${search}` : null)
}

function Field({
  label,
  name,
  type,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  label: string
  name: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  minLength?: number
}) {
  return (
    <label className="field-label">
      {label}
      <input
        autoComplete={autoComplete}
        className="field-input"
        minLength={minLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required
        type={type}
        value={value}
      />
    </label>
  )
}

function GoogleMark() {
  return <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24"><path d="M21.35 12.23c0-.72-.06-1.2-.2-1.7H12v3.58h5.37c-.11.89-.72 2.23-2.08 3.13l-.02.12 3.02 2.29.21.02c1.93-1.74 2.85-4.3 2.85-7.44Z" fill="#4285F4" /><path d="M12 21.5c2.63 0 4.83-.85 6.44-2.32l-3.07-2.43c-.82.56-1.92.95-3.37.95a5.84 5.84 0 0 1-5.54-3.98l-.12.01-3.14 2.38-.04.11A9.69 9.69 0 0 0 12 21.5Z" fill="#34A853" /><path d="M6.46 13.72A5.7 5.7 0 0 1 6.15 12c0-.6.11-1.18.3-1.72v-.12L3.27 7.74l-.1.04A9.34 9.34 0 0 0 2.5 12c0 1.51.36 2.94.67 4.22l3.29-2.5Z" fill="#FBBC05" /><path d="M12 6.3c1.83 0 3.07.78 3.77 1.43l2.75-2.63C16.82 3.55 14.63 2.5 12 2.5a9.69 9.69 0 0 0-8.83 5.28l3.29 2.5A5.84 5.84 0 0 1 12 6.3Z" fill="#EA4335" /></svg>
}

function GitHubMark() {
  return <svg aria-hidden="true" className="size-4 fill-ink" viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 0 0-3 18.51c.48.09.65-.2.65-.46v-1.68c-2.65.57-3.2-1.1-3.2-1.1-.43-1.08-1.05-1.37-1.05-1.37-.86-.58.07-.57.07-.57.95.07 1.45.96 1.45.96.85 1.44 2.23 1.02 2.77.78.09-.6.33-1.02.6-1.26-2.12-.24-4.35-1.05-4.35-4.69 0-1.04.38-1.89.98-2.55-.1-.24-.42-1.21.1-2.52 0 0 .8-.25 2.62.97A9.1 9.1 0 0 1 12 7.25c.81 0 1.62.11 2.38.32 1.82-1.22 2.61-.97 2.61-.97.53 1.31.2 2.28.1 2.52.61.66.98 1.51.98 2.55 0 3.65-2.23 4.44-4.35 4.68.34.29.65.85.65 1.72v2.48c0 .26.17.56.65.46A9.5 9.5 0 0 0 12 2.5Z" /></svg>
}

export function AuthPage() {
  const { config, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [awaitingVerification, setAwaitingVerification] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const returnTo = getReturnTo(location.state)
  const passwordMinLength = config?.passwordMinLength ?? 8

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setAwaitingVerification(false)
    setVerificationCode('')
    setError(null)
    setNotice(null)
  }

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)

    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await insforge.auth.signInWithPassword({
          method: 'password',
          email,
          password,
        })
        if (signInError) throw signInError

        await refreshUser()
        navigate(returnTo, { replace: true })
        return
      }

      const { data, error: signUpError } = await insforge.auth.signUp({
        email,
        password,
        name: name.trim() || undefined,
        redirectTo: `${window.location.origin}/sign-in`,
      })
      if (signUpError) throw signUpError

      if (data?.requireEmailVerification ?? config?.requireEmailVerification) {
        setAwaitingVerification(true)
        setNotice(`We sent a 6-digit verification code to ${email}.`)
        return
      }

      await refreshUser()
      navigate(returnTo, { replace: true })
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'We could not complete that request. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  async function handleOAuth(provider: 'google' | 'github') {
    setPending(true)
    setError(null)
    setNotice(null)
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, returnTo)

    try {
      const { error: oauthError } = await insforge.auth.signInWithOAuth(provider, {
        redirectTo: `${window.location.origin}/auth/callback`,
        ...(provider === 'google' ? { additionalParams: { prompt: 'select_account' } } : {}),
      })
      if (oauthError) throw oauthError
    } catch (caughtError) {
      sessionStorage.removeItem(AUTH_RETURN_TO_KEY)
      setError(toUserErrorMessage(caughtError, `We could not start ${provider === 'google' ? 'Google' : 'GitHub'} sign-in.`))
      setPending(false)
    }
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const { error: verifyError } = await insforge.auth.verifyEmail({ email, otp: verificationCode })
      if (verifyError) throw verifyError

      await refreshUser()
      navigate(returnTo, { replace: true })
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'That code could not be verified.'))
    } finally {
      setPending(false)
    }
  }

  async function resendVerificationCode() {
    setPending(true)
    setError(null)

    try {
      const { data, error: resendError } = await insforge.auth.resendVerificationEmail({
        email,
        redirectTo: `${window.location.origin}/sign-in`,
      })
      if (resendError) throw resendError
      setNotice(data?.message ?? 'A new verification code is on its way.')
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'We could not resend the code.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      {awaitingVerification ? (
        <div>
          <div className="flex justify-end">
            <div className="grid size-8 place-items-center rounded-[5px] bg-status-ready-bg text-status-ready">
              <MailCheck className="size-4" aria-hidden="true" />
            </div>
          </div>
          <h2 className="mt-5 text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-ink">Verify your email</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Enter the six-digit code sent to <span className="font-medium text-ink">{email}</span>.</p>

          <form className="mt-8 space-y-5" onSubmit={handleVerification}>
            <label className="field-label">
              Verification code
              <input
                autoComplete="one-time-code"
                className="field-input h-12 text-center font-mono text-lg tracking-[0.35em]"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}"
                required
                value={verificationCode}
              />
            </label>
            {notice ? <p className="notice-success">{notice}</p> : null}
            {error ? <p className="notice-danger" role="alert">{error}</p> : null}
            <button className="button-primary h-11 w-full" disabled={pending || verificationCode.length !== 6} type="submit">
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              Verify and continue
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-[13px]">
            <button className="font-medium text-link hover:underline disabled:opacity-50" disabled={pending} onClick={() => void resendVerificationCode()} type="button">Resend code</button>
            <button className="text-muted hover:text-ink" onClick={() => switchMode('sign-up')} type="button">Use another email</button>
          </div>
        </div>
      ) : (
        <div>
          <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-ink">{mode === 'sign-in' ? 'Sign in to QueuePilot' : 'Create your account'}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {mode === 'sign-in' ? 'Continue to your publishing workspace.' : 'Create the app account first. YouTube channel access is requested separately.'}
          </p>

          <div className="mt-7 grid grid-cols-2 gap-3">
            <button className="button-secondary h-11 px-3" disabled={pending} onClick={() => void handleOAuth('google')} type="button"><GoogleMark />Google</button>
            <button className="button-secondary h-11 px-3" disabled={pending} onClick={() => void handleOAuth('github')} type="button"><GitHubMark />GitHub</button>
          </div>
          <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">or use email</span><span className="h-px flex-1 bg-border" /></div>

          <form className="space-y-4" onSubmit={handleCredentials}>
            {mode === 'sign-up' ? <Field autoComplete="name" label="Name" name="name" onChange={setName} type="text" value={name} /> : null}
            <Field autoComplete="email" label="Email" name="email" onChange={setEmail} type="email" value={email} />
            <div>
              <Field autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} label="Password" minLength={passwordMinLength} name="password" onChange={setPassword} type="password" value={password} />
              {mode === 'sign-up' ? <p className="field-hint">Use at least {passwordMinLength} characters.</p> : null}
            </div>

            {mode === 'sign-in' ? <div className="text-right"><Link className="text-[13px] font-medium text-link hover:underline" to="/reset-password">Forgot password?</Link></div> : null}
            {error ? <p className="notice-danger" role="alert">{error}</p> : null}

            <button className="button-primary h-11 w-full" disabled={pending} type="submit">
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 border-t border-border pt-5 text-center text-[13px] text-muted">
            {mode === 'sign-in' ? 'New to QueuePilot?' : 'Already have an account?'}{' '}
            <button className="font-medium text-ink hover:underline" onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')} type="button">
              {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
