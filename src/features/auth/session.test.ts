import { describe, expect, it } from 'vitest'
import { isAuthenticationFailure, sessionRecoveryMessage } from './session'

describe('session error classification', () => {
  it('treats only confirmed auth failures as signed-out sessions', () => {
    expect(isAuthenticationFailure({ statusCode: 401, error: 'AUTH_UNAUTHORIZED' })).toBe(true)
    expect(isAuthenticationFailure({ status: 403 })).toBe(true)
    expect(isAuthenticationFailure({ code: 'JWT_EXPIRED' })).toBe(true)
  })

  it('keeps transient failures out of the signed-out path', () => {
    expect(isAuthenticationFailure({ statusCode: 429 })).toBe(false)
    expect(isAuthenticationFailure({ statusCode: 503 })).toBe(false)
    expect(isAuthenticationFailure(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('uses a retry-oriented message for temporary failures', () => {
    expect(sessionRecoveryMessage({ statusCode: 429 })).toContain('rate limited')
    expect(sessionRecoveryMessage({ statusCode: 503 })).toContain('could not verify')
  })
})
