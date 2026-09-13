import { describe, expect, it } from 'vitest'
import { getSafeReturnTo } from './redirects'

describe('getSafeReturnTo', () => {
  it('keeps an internal app path', () => {
    expect(getSafeReturnTo('/app?youtube=connected')).toBe('/app?youtube=connected')
  })

  it('rejects absolute and protocol-relative redirects', () => {
    expect(getSafeReturnTo('https://example.com')).toBe('/app')
    expect(getSafeReturnTo('//example.com')).toBe('/app')
  })

  it('uses a caller-provided fallback for invalid input', () => {
    expect(getSafeReturnTo(null, '/sign-in')).toBe('/sign-in')
  })
})
