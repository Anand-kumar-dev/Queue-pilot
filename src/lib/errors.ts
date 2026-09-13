const NETWORK_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'timeout',
  'econnrefused',
  'enotfound',
]

const AUTH_PATTERNS = [
  'jwt expired',
  'invalid jwt',
  'session expired',
  'not authenticated',
  'authentication required',
  'unauthorized',
  'invalid user session',
  'missing bearer token',
]

const PERMISSION_PATTERNS = [
  'permission denied',
  'not allowed',
  'row-level security',
  'rls',
  'policy violation',
  'owned draft not found',
]

const QUOTA_PATTERNS = [
  'quota exceeded',
  'quotaexceeded',
  'rate limit',
  'ratelimitexceeded',
  'too many requests',
  '429',
  'video uploads per day',
]

const SCHEDULE_PATTERNS = [
  'five minutes in the future',
  'at least five minutes',
  'scheduled releases must',
]

function normalizedMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.toLowerCase()
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message.toLowerCase()
  }
  return ''
}

function containsAny(haystack: string, patterns: string[]) {
  return patterns.some((pattern) => haystack.includes(pattern))
}

/**
 * Map raw SDK/network/backend errors to a safe, user-facing sentence.
 * Never surfaces tokens, keys, SQL, bucket internals, or stack traces.
 */
export function toUserErrorMessage(error: unknown, fallback: string) {
  const haystack = normalizedMessage(error)

  if (!haystack) return fallback
  if (containsAny(haystack, NETWORK_PATTERNS)) {
    return 'We could not reach the workspace service. Check your connection and try again.'
  }
  if (containsAny(haystack, QUOTA_PATTERNS)) {
    return 'YouTube upload quota is exhausted for now. Try again after the daily reset, or request a quota increase before launch week.'
  }
  if (containsAny(haystack, AUTH_PATTERNS)) {
    return 'Your session expired. Sign in again and retry.'
  }
  if (containsAny(haystack, PERMISSION_PATTERNS)) {
    return 'That record is not available in this workspace. Refresh and try again.'
  }
  if (containsAny(haystack, SCHEDULE_PATTERNS)) {
    return 'Schedule the release at least five minutes from now.'
  }
  if (haystack.length > 220 || /[a-f0-9]{32,}/.test(haystack) || haystack.includes('insforge')) {
    return fallback
  }
  if (error instanceof Error && error.message && error.message.length <= 220) {
    return error.message
  }
  return fallback
}
