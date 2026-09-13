import { createAdminClient } from 'npm:@insforge/sdk'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'
const LEASE_SECONDS = 120

type UploadJob = {
  id: string
  video_post_id: string
  user_id: string
  lease_token: string | null
}

class StatusError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly httpStatus?: number) {
    super(message)
  }
}

function getEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new StatusError('server_not_configured', `Missing ${name}`)
  return value
}

function admin() {
  return createAdminClient({ baseUrl: getEnv('INSFORGE_BASE_URL'), apiKey: getEnv('API_KEY') })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

function internalRequest(request: Request) {
  return request.headers.get('Authorization') === `Bearer ${getEnv('API_KEY')}`
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function decryptSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new StatusError('credential_unreadable', 'The stored YouTube credential is invalid.')
  const rawKey = base64UrlDecode(getEnv('YOUTUBE_TOKEN_ENCRYPTION_KEY'))
  if (rawKey.byteLength !== 32) throw new StatusError('server_not_configured', 'The token-encryption key is invalid.')
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(encodedIv) }, key, base64UrlDecode(encodedCiphertext))
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new StatusError('credential_unreadable', 'The stored YouTube credential cannot be decrypted.')
  }
}

async function refreshAccessToken(channelId: string) {
  const { data: credential, error } = await admin().database.from('youtube_channel_credentials')
    .select('refresh_token_ciphertext').eq('channel_id', channelId).single()
  if (error || !credential?.refresh_token_ciphertext) throw new StatusError('refresh_token_missing', 'The channel needs to be reconnected.')
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('YOUTUBE_CLIENT_ID'),
      client_secret: getEnv('YOUTUBE_CLIENT_SECRET'),
      refresh_token: await decryptSecret(credential.refresh_token_ciphertext as string),
      grant_type: 'refresh_token',
    }),
  })
  const payload = await response.json().catch(() => ({})) as { access_token?: string }
  if (!response.ok || !payload.access_token) {
    await admin().database.from('youtube_channels').update({ connection_status: 'refresh_required' }).eq('id', channelId)
    throw new StatusError('refresh_failed', 'YouTube rejected the saved channel authorization.', false, response.status)
  }
  return payload.access_token
}

async function claimJob() {
  const { data, error } = await admin().database.rpc('claim_youtube_upload_job', {
    p_states: ['processing'],
    p_lease_seconds: LEASE_SECONDS,
  })
  if (error) throw new StatusError('claim_failed', 'Could not claim a processing job.', true)
  const job = Array.isArray(data) ? data[0] : data
  return job && typeof job === 'object' && typeof (job as { id?: unknown }).id === 'string'
    ? job as UploadJob
    : null
}

async function event(job: UploadJob, type: string, detail: Record<string, unknown> = {}) {
  await admin().database.from('video_post_events').insert([{
    video_post_id: job.video_post_id, user_id: job.user_id, event_type: type, detail,
  }])
}

async function fail(job: UploadJob, error: StatusError) {
  const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  await admin().database.from('youtube_upload_jobs').update({
    state: error.retryable ? 'processing' : 'failed',
    next_attempt_at: error.retryable ? retryAt : new Date().toISOString(),
    lease_token: null, lease_expires_at: null,
    last_http_status: error.httpStatus ?? null,
    last_error_code: error.code, last_error_detail: error.message,
  }).eq('id', job.id).eq('lease_token', job.lease_token)
  await admin().database.from('video_posts').update({
    status: error.retryable ? 'processing' : 'failed',
    last_error_code: error.code, last_error_message: error.message,
    completed_at: error.retryable ? null : new Date().toISOString(),
  }).eq('id', job.video_post_id).eq('user_id', job.user_id)
  await event(job, error.retryable ? 'status_retry_scheduled' : 'status_failed', { code: error.code })
}

async function checkJob(job: UploadJob) {
  const { data: post, error } = await admin().database.from('video_posts')
    .select('id,channel_id,youtube_video_id,publish_at').eq('id', job.video_post_id).eq('user_id', job.user_id).single()
  if (error || !post?.channel_id || !post.youtube_video_id) throw new StatusError('youtube_video_missing', 'The uploaded video cannot be reconciled.')
  const accessToken = await refreshAccessToken(post.channel_id as string)
  const url = new URL(YOUTUBE_VIDEOS_URL)
  url.search = new URLSearchParams({ part: 'status,processingDetails', id: post.youtube_video_id as string }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new StatusError('youtube_status_failed', 'YouTube status could not be read.', response.status >= 500 || response.status === 429, response.status)
  const payload = await response.json() as { items?: Array<{ status?: { privacyStatus?: string; uploadStatus?: string; publishAt?: string }; processingDetails?: { processingStatus?: string; processingFailureReason?: string } }> }
  const video = payload.items?.[0]
  if (!video) throw new StatusError('youtube_video_not_found', 'YouTube no longer returned the uploaded video.', false)

  const uploadStatus = video.status?.uploadStatus ?? ''
  const processingStatus = video.processingDetails?.processingStatus ?? ''
  if (uploadStatus === 'failed' || uploadStatus === 'rejected' || processingStatus === 'failed') {
    throw new StatusError('youtube_processing_failed', video.processingDetails?.processingFailureReason ?? 'YouTube rejected video processing.', false)
  }
  if (uploadStatus !== 'processed' || processingStatus === 'processing' || processingStatus === 'terminated') {
    await admin().database.from('youtube_upload_jobs').update({
      state: 'processing', next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), lease_token: null, lease_expires_at: null,
    }).eq('id', job.id).eq('lease_token', job.lease_token)
    return { state: 'processing' }
  }

  const now = Date.now()
  const target = video.status?.publishAt ?? post.publish_at
  const targetTime = target ? new Date(target).getTime() : NaN
  const privacy = video.status?.privacyStatus
  const finalStatus = Number.isFinite(targetTime) && targetTime > now
    ? 'scheduled'
    : privacy === 'public'
      ? 'published'
      : 'ready'
  const needsReleaseRecheck = finalStatus === 'scheduled'
  await admin().database.from('youtube_upload_jobs').update({
    // A YouTube-confirmed scheduled release remains under reconciliation until
    // the target time passes and YouTube reports the public state.
    state: needsReleaseRecheck ? 'processing' : 'succeeded',
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: needsReleaseRecheck
      ? new Date(Math.max(targetTime + 60_000, Date.now() + 5 * 60 * 1000)).toISOString()
      : new Date().toISOString(),
    last_error_code: null, last_error_detail: null,
  }).eq('id', job.id).eq('lease_token', job.lease_token)
  await admin().database.from('video_posts').update({
    status: finalStatus,
    published_at: finalStatus === 'published' ? new Date().toISOString() : null,
    completed_at: new Date().toISOString(),
    last_error_code: null, last_error_message: null,
  }).eq('id', job.video_post_id).eq('user_id', job.user_id)
  await event(job, `youtube_${finalStatus}`, { privacy_status: privacy ?? null, publish_at: target ?? null })
  return { state: finalStatus }
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)
    if (!internalRequest(request)) return json({ code: 'unauthorized' }, 401)
    const job = await claimJob()
    if (!job) return json({ processed: false, reason: 'no_processing_job' })
    try {
      const result = await checkJob(job)
      return json({ processed: true, jobId: job.id, ...result })
    } catch (caughtError) {
      const error = caughtError instanceof StatusError ? caughtError : new StatusError('unexpected_status_error', 'The YouTube status worker failed unexpectedly.', true)
      await fail(job, error)
      return json({ processed: true, jobId: job.id, state: error.retryable ? 'processing' : 'failed', code: error.code })
    }
  } catch (caughtError) {
    const error = caughtError instanceof StatusError ? caughtError : new StatusError('worker_unavailable', 'The status worker is unavailable.')
    return json({ code: error.code, error: error.message }, error.code === 'unauthorized' ? 401 : 503)
  }
}
