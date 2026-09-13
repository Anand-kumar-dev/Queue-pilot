import { toUserErrorMessage } from '../../lib/errors'

export function getErrorMessage(error: unknown, fallback: string) {
  return toUserErrorMessage(error, fallback)
}
