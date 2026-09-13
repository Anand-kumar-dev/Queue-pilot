export const AUTH_RETURN_TO_KEY = 'queuepilot.auth.returnTo'

export function getSafeReturnTo(value: unknown, fallback = '/app') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback
  }

  return value
}
