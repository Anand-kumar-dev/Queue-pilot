const AUTH_ERROR_CODES = new Set([
  'AUTH_INVALID_SESSION',
  'AUTH_SESSION_EXPIRED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_UNAUTHORIZED',
  'INVALID_JWT',
  'JWT_EXPIRED',
])

function readNumber(error: unknown, key: string) {
  if (typeof error !== 'object' || error === null || !(key in error)) return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

function readString(error: unknown, key: string) {
  if (typeof error !== 'object' || error === null || !(key in error)) return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

export function isAuthenticationFailure(error: unknown) {
  const status = readNumber(error, 'statusCode') ?? readNumber(error, 'status')
  if (status === 401 || status === 403) return true

  const code = readString(error, 'error') ?? readString(error, 'code')
  return code ? AUTH_ERROR_CODES.has(code.toUpperCase()) : false
}

export function sessionRecoveryMessage(error: unknown) {
  const status = readNumber(error, 'statusCode') ?? readNumber(error, 'status')

  if (status === 429) {
    return 'Session verification is temporarily rate limited. Your workspace is still open; retry in a moment.'
  }
  if (status === null && typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You are offline. Your workspace will reconnect without signing you out.'
  }
  return 'Queue Pilot could not verify the session right now. Your work is preserved; retry when the service is reachable.'
}
