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

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'github') return <span className="text-[10px] font-bold" aria-hidden="true">GH</span>
  if (provider === 'google') return <span className="text-sm font-bold text-[#4285f4]" aria-hidden="true">G</span>
  return <span className="text-xs font-bold uppercase" aria-hidden="true">{provider.slice(0, 1)}</span>
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

export function AuthPage() {
  const { config, configError, configLoading, refreshUser } = useAuth()
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
  const providers = [...(config?.oAuthProviders ?? []), ...(config?.customOAuthProviders ?? [])]

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

  async function handleOAuth(provider: string) {
    setPending(true)
    setError(null)
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, returnTo)

    const { error: oauthError } = await insforge.auth.signInWithOAuth(provider, {
      redirectTo: `${window.location.origin}/auth/callback`,
      additionalParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    })

    if (oauthError) {
      setError(toUserErrorMessage(oauthError, `Could not continue with ${provider}.`))
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      {awaitingVerification ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="technical-label">Account / verification</p>
            <div className="grid size-8 place-items-center rounded-[5px] bg-status-ready-bg text-status-ready">
              <MailCheck className="size-4" aria-hidden="true" />
            </div>
          </div>
          <h2 className="mt-5 text-[30px] font-medium leading-tight tracking-[-0.035em] text-ink">Verify your email</h2>
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
          <p className="technical-label">QueuePilot / access</p>
          <h2 className="mt-4 text-[30px] font-medium leading-tight tracking-[-0.035em] text-ink">{mode === 'sign-in' ? 'Sign in to QueuePilot' : 'Create your account'}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {mode === 'sign-in' ? 'Continue to your publishing workspace.' : 'Create the app account first. YouTube channel access is requested separately.'}
          </p>

          {providers.length > 0 ? (
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {providers.map((provider) => (
                <button
                  className="button-secondary h-11 capitalize"
                  disabled={pending}
                  key={provider}
                  onClick={() => void handleOAuth(provider)}
                  type="button"
                >
                  <ProviderIcon provider={provider} />
                  {provider}
                </button>
              ))}
            </div>
          ) : null}

          {providers.length > 0 ? (
            <div className="my-6 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-soft">
              <span className="h-px flex-1 bg-border" />or use email<span className="h-px flex-1 bg-border" />
            </div>
          ) : <div className="h-7" />}

          <form className="space-y-4" onSubmit={handleCredentials}>
            {mode === 'sign-up' ? <Field autoComplete="name" label="Name" name="name" onChange={setName} type="text" value={name} /> : null}
            <Field autoComplete="email" label="Email" name="email" onChange={setEmail} type="email" value={email} />
            <div>
              <Field autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} label="Password" minLength={passwordMinLength} name="password" onChange={setPassword} type="password" value={password} />
              {mode === 'sign-up' ? <p className="field-hint">Use at least {passwordMinLength} characters.</p> : null}
            </div>

            {mode === 'sign-in' ? <div className="text-right"><Link className="text-[13px] font-medium text-link hover:underline" to="/reset-password">Forgot password?</Link></div> : null}
            {configError ? <p className="notice-warning" role="alert">Authentication settings could not be loaded: {configError}</p> : null}
            {error ? <p className="notice-danger" role="alert">{error}</p> : null}

            <button className="button-primary h-11 w-full" disabled={pending || configLoading} type="submit">
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
