import { createAdminClient } from 'npm:@insforge/sdk'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const YOUTUBE_THUMBNAIL_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set'
const LEASE_SECONDS = 240
const WORKER_BUDGET_MS = 150_000

type UploadJob = {
  id: string
  video_post_id: string
  user_id: string
  state: string
  resumable_session_ciphertext: string | null
  offset_bytes: number | string
  total_bytes: number | string
  chunk_size_bytes: number
  attempt_count: number | string
  lease_token: string | null
}

class WorkerError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly httpStatus?: number) {
    super(message)
  }
}

function getEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new WorkerError('server_not_configured', `Missing ${name}`)
  return value
}

function getAdmin() {
  return createAdminClient({ baseUrl: getEnv('INSFORGE_BASE_URL'), apiKey: getEnv('API_KEY') })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

function isInternal(request: Request) {
  return request.headers.get('Authorization') === `Bearer ${getEnv('API_KEY')}`
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function encryptionKey() {
  const rawKey = base64UrlDecode(getEnv('YOUTUBE_TOKEN_ENCRYPTION_KEY'))
  if (rawKey.byteLength !== 32) throw new WorkerError('server_not_configured', 'The token-encryption key is invalid.')
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value))
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`
}

async function decryptSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new WorkerError('credential_unreadable', 'The stored YouTube credential is invalid.')
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(encodedIv) },
      await encryptionKey(),
      base64UrlDecode(encodedCiphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new WorkerError('credential_unreadable', 'The stored YouTube credential cannot be decrypted.')
  }
}

async function refreshAccessToken(channelId: string) {
  const admin = getAdmin()
  const { data: credential, error } = await admin.database
    .from('youtube_channel_credentials')
    .select('refresh_token_ciphertext')
    .eq('channel_id', channelId)
    .single()
  if (error || !credential?.refresh_token_ciphertext) throw new WorkerError('refresh_token_missing', 'The channel needs to be reconnected.')

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
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string }
  if (!response.ok || !payload.access_token) {
    await admin.database.from('youtube_channels').update({ connection_status: 'refresh_required' }).eq('id', channelId)
    throw new WorkerError('refresh_failed', 'YouTube rejected the saved channel authorization.', false, response.status)
  }

  await admin.database.from('youtube_channel_credentials').update({
    access_token_ciphertext: await encryptSecret(payload.access_token),
    access_token_expires_at: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
    last_refresh_error_code: null,
  }).eq('channel_id', channelId)

  return payload.access_token
}

async function claimJob() {
  const { data, error } = await getAdmin().database.rpc('claim_youtube_upload_job', {
    p_states: ['queued', 'retry_wait'],
    p_lease_seconds: LEASE_SECONDS,
  })
  if (error) throw new WorkerError('claim_failed', 'Could not claim an upload job.', true)
  const job = Array.isArray(data) ? data[0] : data
  return job && typeof job === 'object' && typeof (job as { id?: unknown }).id === 'string'
    ? job as UploadJob
    : null
}

async function recordEvent(videoPostId: string, userId: string, eventType: string, detail: Record<string, unknown> = {}) {
  await getAdmin().database.from('video_post_events').insert([{
    video_post_id: videoPostId,
    user_id: userId,
    event_type: eventType,
    detail,
  }])
}

async function retryOrFail(job: UploadJob, error: WorkerError) {
  const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const retry = error.retryable
  const admin = getAdmin()
  await admin.database.from('youtube_upload_jobs').update({
    state: retry ? 'retry_wait' : 'failed',
    next_attempt_at: retry ? retryAt : new Date().toISOString(),
    lease_token: null,
    lease_expires_at: null,
    last_http_status: error.httpStatus ?? null,
    last_error_code: error.code,
    last_error_detail: error.message,
  }).eq('id', job.id).eq('lease_token', job.lease_token)
  await admin.database.from('video_posts').update({
    status: retry ? 'queued' : 'failed',
    last_error_code: error.code,
    last_error_message: error.message,
    completed_at: retry ? null : new Date().toISOString(),
  }).eq('id', job.video_post_id).eq('user_id', job.user_id)
  await recordEvent(job.video_post_id, job.user_id, retry ? 'retry_scheduled' : 'failed', {
    code: error.code,
    retry_at: retry ? retryAt : null,
  })
}

async function releaseForNextRun(job: UploadJob) {
  await getAdmin().database.from('youtube_upload_jobs').update({
    state: 'queued',
    next_attempt_at: new Date().toISOString(),
    lease_token: null,
    lease_expires_at: null,
  }).eq('id', job.id).eq('lease_token', job.lease_token)
  await getAdmin().database.from('video_posts').update({ status: 'queued' }).eq('id', job.video_post_id)
}

async function getUploadContext(job: UploadJob) {
  const admin = getAdmin()
  const { data: post, error: postError } = await admin.database
    .from('video_posts')
    .select('id,channel_id,video_asset_id,thumbnail_asset_id,title,description,tags,category_id,default_language,target_privacy_status,made_for_kids,contains_synthetic_media,notify_subscribers,license,embeddable,public_stats_viewable,publish_at')
    .eq('id', job.video_post_id)
    .eq('user_id', job.user_id)
    .single()
  if (postError || !post?.channel_id || !post.video_asset_id) throw new WorkerError('release_unavailable', 'The queued release is incomplete.')

  const { data: channel, error: channelError } = await admin.database
    .from('youtube_channels')
    .select('id,connection_status')
    .eq('id', post.channel_id)
    .eq('user_id', job.user_id)
    .single()
  if (channelError || !channel || channel.connection_status !== 'active') throw new WorkerError('channel_not_active', 'The destination channel needs to be reconnected.')

  const { data: asset, error: assetError } = await admin.database
    .from('media_assets')
    .select('bucket,key,mime_type,size_bytes')
    .eq('id', post.video_asset_id)
    .eq('user_id', job.user_id)
    .single()
  if (assetError || !asset) throw new WorkerError('source_missing', 'The source video is unavailable.')

  let thumbnail: { bucket: string; key: string; mime_type: string } | null = null
  if (post.thumbnail_asset_id) {
    const { data } = await admin.database.from('media_assets')
      .select('bucket,key,mime_type')
      .eq('id', post.thumbnail_asset_id).eq('user_id', job.user_id).maybeSingle()
    if (data) thumbnail = data as typeof thumbnail
  }
  return { post, channel, asset, thumbnail }
}

async function signedObjectUrl(bucket: string, key: string) {
  const { data, error } = await getAdmin().storage.from(bucket).createSignedUrl(key, 20 * 60)
  if (error || !data?.signedUrl) throw new WorkerError('source_download_unavailable', 'The private source video could not be read.', true)
  return data.signedUrl
}

async function startSession(accessToken: string, context: Awaited<ReturnType<typeof getUploadContext>>) {
  const scheduled = Boolean(context.post.publish_at)
  const response = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': context.asset.mime_type,
      'X-Upload-Content-Length': String(context.asset.size_bytes),
    },
    body: JSON.stringify({
      snippet: {
        title: context.post.title,
        description: context.post.description,
        tags: context.post.tags,
        categoryId: context.post.category_id,
        ...(context.post.default_language ? { defaultLanguage: context.post.default_language } : {}),
      },
      status: {
        privacyStatus: scheduled ? 'private' : context.post.target_privacy_status,
        ...(scheduled ? { publishAt: context.post.publish_at } : {}),
        selfDeclaredMadeForKids: context.post.made_for_kids,
        containsSyntheticMedia: context.post.contains_synthetic_media,
        notifySubscribers: context.post.notify_subscribers,
        license: context.post.license,
        embeddable: context.post.embeddable,
        publicStatsViewable: context.post.public_stats_viewable,
      },
    }),
  })
  if (!response.ok) {
    throw new WorkerError('youtube_session_failed', 'YouTube did not accept the release manifest.', response.status >= 500, response.status)
  }
  const sessionUrl = response.headers.get('Location')
  if (!sessionUrl) throw new WorkerError('youtube_session_missing', 'YouTube did not return a resumable upload session.', true)
  return sessionUrl
}

async function setThumbnail(accessToken: string, videoId: string, thumbnail: { bucket: string; key: string; mime_type: string }) {
  const url = await signedObjectUrl(thumbnail.bucket, thumbnail.key)
  const source = await fetch(url)
  if (!source.ok) throw new WorkerError('thumbnail_download_failed', 'The private thumbnail could not be read.', true, source.status)
  const response = await fetch(`${YOUTUBE_THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': thumbnail.mime_type },
    body: await source.arrayBuffer(),
  })
  if (!response.ok) throw new WorkerError('thumbnail_upload_failed', 'YouTube rejected the custom thumbnail.', false, response.status)
}

async function uploadJob(job: UploadJob) {
  const startedAt = Date.now()
  const admin = getAdmin()
  const context = await getUploadContext(job)
  const accessToken = await refreshAccessToken(context.channel.id)
  let sessionUrl = job.resumable_session_ciphertext ? await decryptSecret(job.resumable_session_ciphertext) : null
  let offset = Number(job.offset_bytes)
  const total = Number(job.total_bytes)
  const chunkSize = Number(job.chunk_size_bytes)

  await admin.database.from('youtube_upload_jobs').update({
    state: 'uploading', attempt_count: Number(job.attempt_count) + 1, lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
  }).eq('id', job.id).eq('lease_token', job.lease_token)
  await admin.database.from('video_posts').update({ status: 'uploading', last_error_code: null, last_error_message: null }).eq('id', job.video_post_id)

  if (!sessionUrl) {
    sessionUrl = await startSession(accessToken, context)
    await admin.database.from('youtube_upload_jobs').update({
      state: 'uploading', resumable_session_ciphertext: await encryptSecret(sessionUrl),
      resumable_session_expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq('id', job.id).eq('lease_token', job.lease_token)
  }

  const sourceUrl = await signedObjectUrl(context.asset.bucket, context.asset.key)
  while (offset < total) {
    if (Date.now() - startedAt > WORKER_BUDGET_MS) {
      await releaseForNextRun(job)
      return { outcome: 'continued' as const }
    }
    const end = Math.min(offset + chunkSize, total) - 1
    const source = await fetch(sourceUrl, { headers: { Range: `bytes=${offset}-${end}` } })
    if (!source.ok) throw new WorkerError('source_range_failed', 'The source video could not be read for transfer.', source.status >= 500, source.status)
    const body = await source.arrayBuffer()
    const expectedBytes = end - offset + 1
    if (body.byteLength !== expectedBytes) throw new WorkerError('source_range_incomplete', 'The source video returned an incomplete transfer chunk.', true)

    const response = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': context.asset.mime_type,
        'Content-Length': String(body.byteLength),
        'Content-Range': `bytes ${offset}-${end}/${total}`,
      },
      body,
    })
    if (response.status === 308) {
      const range = response.headers.get('Range')
      const acknowledged = range?.match(/bytes=0-(\d+)/)?.[1]
      offset = acknowledged ? Number(acknowledged) + 1 : end + 1
      await admin.database.from('youtube_upload_jobs').update({
        offset_bytes: offset,
        state: 'uploading',
        lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
      }).eq('id', job.id).eq('lease_token', job.lease_token)
      await admin.database.from('video_posts').update({ progress_bytes: offset }).eq('id', job.video_post_id)
      continue
    }
    if (!response.ok) {
      throw new WorkerError('youtube_chunk_failed', 'YouTube did not accept the current upload chunk.', response.status >= 500 || response.status === 429, response.status)
    }
    const result = await response.json().catch(() => null) as { id?: string } | null
    if (!result?.id) throw new WorkerError('youtube_video_missing', 'YouTube completed the upload without returning a video identifier.', true)
    if (context.thumbnail) await setThumbnail(accessToken, result.id, context.thumbnail)

    await admin.database.from('youtube_upload_jobs').update({
      state: 'processing', offset_bytes: total, lease_token: null, lease_expires_at: null,
      next_attempt_at: new Date().toISOString(),
    }).eq('id', job.id).eq('lease_token', job.lease_token)
    await admin.database.from('video_posts').update({
      status: 'processing', youtube_video_id: result.id, progress_bytes: total, uploaded_at: new Date().toISOString(),
    }).eq('id', job.video_post_id)
    await recordEvent(job.video_post_id, job.user_id, 'youtube_upload_complete', { youtube_video_id: result.id })
    return { outcome: 'uploaded' as const, videoId: result.id }
  }

  throw new WorkerError('youtube_upload_state_invalid', 'The saved upload offset is invalid.', true)
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)
    if (!isInternal(request)) return json({ code: 'unauthorized' }, 401)
    const job = await claimJob()
    if (!job) return json({ processed: false, reason: 'no_queued_job' })
    try {
      const result = await uploadJob(job)
      return json({ processed: true, jobId: job.id, ...result })
    } catch (caughtError) {
      const error = caughtError instanceof WorkerError
        ? caughtError
        : new WorkerError('unexpected_upload_error', 'The upload worker encountered an unexpected error.', true)
      await retryOrFail(job, error)
      return json({ processed: true, jobId: job.id, outcome: error.retryable ? 'retry_wait' : 'failed', code: error.code }, 200)
    }
  } catch (caughtError) {
    const error = caughtError instanceof WorkerError ? caughtError : new WorkerError('worker_unavailable', 'The upload worker is unavailable.')
    return json({ code: error.code, error: error.message }, error.code === 'unauthorized' ? 401 : 503)
  }
}
