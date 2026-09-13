import { createClient } from 'npm:@insforge/sdk'

class PublishingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

function getEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new PublishingError('server_not_configured', `Missing ${name}`)
  return value
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin')
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '') ?? ''
  const allowedOrigins = new Set(
    (Deno.env.get('APP_ALLOWED_ORIGINS') ?? appUrl)
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean),
  )
  const allowedOrigin = origin && allowedOrigins.has(origin.replace(/\/$/, '')) ? origin : appUrl

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function userClient(request: Request) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new PublishingError('unauthorized', 'Sign in before changing the publishing queue.')
  }

  const client = createClient({
    baseUrl: getEnv('INSFORGE_BASE_URL'),
    accessToken: authorization.slice('Bearer '.length),
  })
  const { data, error } = await client.auth.getCurrentUser()
  if (error || !data.user) throw new PublishingError('unauthorized', 'Your session is no longer valid.')
  return client
}

function postIdFrom(body: Record<string, unknown>) {
  if (typeof body.videoPostId !== 'string' || !body.videoPostId.trim()) {
    throw new PublishingError('invalid_request', 'videoPostId is required.')
  }
  return body.videoPostId
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin')
    const headers = corsHeaders(request)
    if (origin && headers['Access-Control-Allow-Origin'] !== origin) return json(request, { code: 'origin_not_allowed' }, 403)
    return new Response(null, { status: 204, headers })
  }

  try {
    if (request.method !== 'POST') return json(request, { code: 'method_not_allowed' }, 405)
    const origin = request.headers.get('Origin')
    const headers = corsHeaders(request)
    if (origin && headers['Access-Control-Allow-Origin'] !== origin) return json(request, { code: 'origin_not_allowed' }, 403)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.action !== 'string') throw new PublishingError('invalid_request', 'A publishing action is required.')

    const client = await userClient(request)
    const videoPostId = postIdFrom(body)

    if (body.action === 'enqueue') {
      const { data, error } = await client.database.rpc('enqueue_video_post', { p_video_post_id: videoPostId })
      if (error) throw error
      return json(request, { queued: true, job: data })
    }
    if (body.action === 'retry') {
      const { data, error } = await client.database.rpc('retry_video_post', { p_video_post_id: videoPostId })
      if (error) throw error
      return json(request, { queued: true, job: data })
    }
    if (body.action === 'cancel') {
      const { error } = await client.database.rpc('cancel_queued_video_post', { p_video_post_id: videoPostId })
      if (error) throw error
      return json(request, { cancelled: true })
    }

    throw new PublishingError('invalid_request', 'Unknown publishing action.')
  } catch (caughtError) {
    const error = caughtError instanceof PublishingError
      ? caughtError
      : new PublishingError('request_failed', 'The publishing request could not be completed.')
    const status = error.code === 'unauthorized' ? 401
      : error.code === 'origin_not_allowed' ? 403
      : error.code === 'server_not_configured' ? 503
      : 400
    return json(request, { code: error.code, error: error.message }, status)
  }
}
