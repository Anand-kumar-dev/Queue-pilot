import { insforge } from './insforge'

/**
 * Invoke through the project's compatibility route instead of the Deno
 * subhosting hostname. The latter has a platform-level CORS allowlist that
 * cannot see QueuePilot's custom Vercel domain; the compatibility route uses
 * the same authenticated SDK client and reaches the active function safely.
 */
export async function invokeAppFunction<T>(slug: string, body: Record<string, unknown>) {
  try {
    const data = await insforge.getHttpClient().post<T>(`/functions/${slug}`, body)
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}
