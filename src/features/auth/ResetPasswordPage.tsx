import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { insforge } from '../../lib/insforge'
import { toUserErrorMessage } from '../../lib/errors'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthContext'

type ResetPhase = 'request' | 'code' | 'new-password' | 'success'

export function ResetPasswordPage() {
  const { config, configLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const linkToken = searchParams.get('token')
  const linkReady = searchParams.get('insforge_status') === 'ready' && Boolean(linkToken)
  const [phase, setPhase] = useState<ResetPhase>(linkReady ? 'new-password' : 'request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState(linkToken ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const minLength = config?.passwordMinLength ?? 8

  useEffect(() => {
    if (linkReady && linkToken) {
      setResetToken(linkToken)
      setPhase('new-password')
    }
  }, [linkReady, linkToken])

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const { data, error: requestError } = await insforge.auth.sendResetPasswordEmail({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (requestError) throw requestError
      setNotice(data?.message ?? 'Check your inbox for the next step.')
      if ((config?.resetPasswordMethod ?? 'code') === 'code') setPhase('code')
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'We could not send the password reset email.'))
    } finally {
      setPending(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const { data, error: exchangeError } = await insforge.auth.exchangeResetPasswordToken({ email, code })
      if (exchangeError) throw exchangeError
      if (!data?.token) throw new Error('The reset token was missing. Please request a new code.')
      setResetToken(data.token)
      setPhase('new-password')
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'That reset code could not be verified.'))
    } finally {
      setPending(false)
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setPending(true)
    try {
      const { error: resetError } = await insforge.auth.resetPassword({ newPassword, otp: resetToken })
      if (resetError) throw resetError
      setPhase('success')
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'Your password could not be updated.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      {phase === 'success' ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="technical-label">Account / recovery</p>
            <div className="grid size-8 place-items-center rounded-[5px] bg-status-ready-bg text-status-ready"><CheckCircle2 className="size-4" aria-hidden="true" /></div>
          </div>
          <h2 className="mt-5 text-[30px] font-medium leading-tight tracking-[-0.035em] text-ink">Password updated</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Your account now uses the new password. Return to sign in when you are ready.</p>
          <Link className="button-primary mt-8 h-11 w-full" to="/sign-in">Back to sign in</Link>
        </div>
      ) : (
        <div>
          <p className="technical-label">Account / recovery</p>
          <h2 className="mt-4 text-[30px] font-medium leading-tight tracking-[-0.035em] text-ink">
            {phase === 'request' ? 'Reset your password' : phase === 'code' ? 'Enter your reset code' : 'Choose a new password'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {phase === 'request' ? 'We will send recovery instructions to your account email.' : phase === 'code' ? `Use the code sent to ${email}.` : `Use at least ${minLength} characters for your new password.`}
          </p>

          {phase === 'request' ? (
            <form className="mt-8 space-y-5" onSubmit={requestReset}>
              <label className="field-label">Email<input autoComplete="email" className="field-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
              {notice ? <p className="notice-success">{notice}</p> : null}
              {error ? <p className="notice-danger" role="alert">{error}</p> : null}
              <button className="button-primary h-11 w-full" disabled={pending || configLoading} type="submit">{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}Send reset instructions</button>
            </form>
          ) : null}

          {phase === 'code' ? (
            <form className="mt-8 space-y-5" onSubmit={verifyCode}>
              <label className="field-label">Reset code<input autoComplete="one-time-code" className="field-input h-12 text-center font-mono text-lg tracking-[0.35em]" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={code} /></label>
              {notice ? <p className="notice-success">{notice}</p> : null}
              {error ? <p className="notice-danger" role="alert">{error}</p> : null}
              <button className="button-primary h-11 w-full" disabled={pending || code.length !== 6} type="submit">{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}Continue</button>
            </form>
          ) : null}

          {phase === 'new-password' ? (
            <form className="mt-8 space-y-4" onSubmit={updatePassword}>
              <label className="field-label">New password<input autoComplete="new-password" className="field-input" minLength={minLength} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
              <label className="field-label">Confirm password<input autoComplete="new-password" className="field-input" minLength={minLength} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
              {error ? <p className="notice-danger" role="alert">{error}</p> : null}
              <button className="button-primary h-11 w-full" disabled={pending} type="submit">{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}Update password</button>
            </form>
          ) : null}

          <p className="mt-6 border-t border-border pt-5 text-center text-[13px]"><Link className="font-medium text-ink hover:underline" to="/sign-in">Back to sign in</Link></p>
        </div>
      )}
    </AuthLayout>
  )
}
