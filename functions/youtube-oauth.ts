import { createAdminClient, createClient } from 'npm:@insforge/sdk'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

interface YoutubeChannelResponse {
  items?: Array<{
    id: string
    snippet?: {
      title?: string
      customUrl?: string
      country?: string
      thumbnails?: Record<string, { url?: string }>
    }
    contentDetails?: {
      relatedPlaylists?: { uploads?: string }
    }
  }>
}

class OAuthFlowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

function getEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new OAuthFlowError('server_not_configured', `Missing ${name}`)
  return value
}

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin')
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '')
  const allowedOrigins = new Set(
    (Deno.env.get('APP_ALLOWED_ORIGINS') ?? appUrl ?? '')
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean),
  )
  const allowOrigin = origin && allowedOrigins.has(origin.replace(/\/$/, '')) ? origin : appUrl ?? ''

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomToken(byteLength: number) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function sha256Hex(value: string) {
  const digest = await sha256Bytes(value)
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function getEncryptionKey() {
  const rawKey = base64UrlDecode(getEnv('YOUTUBE_TOKEN_ENCRYPTION_KEY'))
  if (rawKey.byteLength !== 32) {
    throw new OAuthFlowError('server_not_configured', 'YOUTUBE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes')
  }
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptSecret(plaintext: string) {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`
}

async function decryptSecret(envelope: string) {
  const [version, encodedIv, encodedCiphertext] = envelope.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new OAuthFlowError('credential_unreadable', 'Unsupported encrypted credential format')
  }
  const key = await getEncryptionKey()
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(encodedIv) },
    key,
    base64UrlDecode(encodedCiphertext),
  )
  return new TextDecoder().decode(decrypted)
}

function safeReturnTo(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/app'
}

function appRedirect(returnTo: string, params: Record<string, string>) {
  const appUrl = getEnv('APP_URL').replace(/\/$/, '')
  const target = new URL(safeReturnTo(returnTo), `${appUrl}/`)
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return target.toString()
}

function getAdminClient() {
  return createAdminClient({ baseUrl: getEnv('INSFORGE_BASE_URL'), apiKey: getEnv('API_KEY') })
}

async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) throw new OAuthFlowError('unauthorized', 'Missing bearer token')

  const client = createClient({
    baseUrl: getEnv('INSFORGE_BASE_URL'),
    accessToken: authorization.slice('Bearer '.length),
  })
  const { data, error } = await client.auth.getCurrentUser()
  if (error || !data.user) throw new OAuthFlowError('unauthorized', 'Invalid user session')
  return data.user
}

async function revokeGoogleToken(token: string) {
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined)
}

async function startConnection(request: Request, body: Record<string, unknown>) {
  const user = await getAuthenticatedUser(request)
  const clientId = getEnv('YOUTUBE_CLIENT_ID')
  getEnv('YOUTUBE_CLIENT_SECRET')
  const redirectUri = getEnv('YOUTUBE_REDIRECT_URI')
  await getEncryptionKey()

  const state = randomToken(32)
  const codeVerifier = randomToken(48)
  const codeChallenge = base64UrlEncode(await sha256Bytes(codeVerifier))
  const stateHash = await sha256Hex(state)
  const admin = getAdminClient()
  const now = Date.now()

  const { error } = await admin.database.from('youtube_oauth_states').insert([{
    state_hash: stateHash,
    user_id: user.id,
    code_verifier_ciphertext: await encryptSecret(codeVerifier),
    redirect_uri: redirectUri,
    return_to: safeReturnTo(body.returnTo),
    expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
  }])
  if (error) throw new OAuthFlowError('state_storage_failed', 'Could not store OAuth state')

  const authorizationUrl = new URL(GOOGLE_AUTH_URL)
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Explicit account selection keeps "Connect another channel" useful even
    // when the browser already has a Google account session.
    prompt: 'select_account consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString()

  return json(request, { authorizationUrl: authorizationUrl.toString() })
}

async function consumeOAuthState(state: string) {
  const admin = getAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await admin.database
    .from('youtube_oauth_states')
    .update({ consumed_at: now })
    .eq('state_hash', await sha256Hex(state))
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('user_id,code_verifier_ciphertext,redirect_uri,return_to')
    .single()

  if (error || !data) throw new OAuthFlowError('invalid_state', 'OAuth state is invalid, expired, or already used')
  return data as {
    user_id: string
    code_verifier_ciphertext: string
    redirect_uri: string
    return_to: string
  }
}

async function exchangeCode(code: string, redirectUri: string, codeVerifier: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getEnv('YOUTUBE_CLIENT_ID'),
      client_secret: getEnv('YOUTUBE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (!response.ok) throw new OAuthFlowError('token_exchange_failed', 'Google rejected the authorization code')
  return (await response.json()) as GoogleTokenResponse
}

async function fetchYoutubeChannel(accessToken: string) {
  const url = new URL(YOUTUBE_CHANNELS_URL)
  url.search = new URLSearchParams({ part: 'id,snippet,contentDetails', mine: 'true', maxResults: '1' }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new OAuthFlowError('channel_lookup_failed', 'Could not read the authorized YouTube channel')

  const payload = (await response.json()) as YoutubeChannelResponse
  const channel = payload.items?.[0]
  if (!channel?.id) throw new OAuthFlowError('channel_not_found', 'The Google account has no YouTube channel')
  return channel
}

async function finishConnection(request: Request) {
  const requestUrl = new URL(request.url)
  const state = requestUrl.searchParams.get('state')
  const code = requestUrl.searchParams.get('code')
  const googleError = requestUrl.searchParams.get('error')
  if (!state) throw new OAuthFlowError('invalid_state', 'Missing OAuth state')

  const oauthState = await consumeOAuthState(state)
  if (googleError) {
    return Response.redirect(appRedirect(oauthState.return_to, { youtube: 'error', reason: 'authorization_denied' }), 302)
  }
  if (!code) throw new OAuthFlowError('missing_code', 'Missing authorization code')

  const codeVerifier = await decryptSecret(oauthState.code_verifier_ciphertext)
  const token = await exchangeCode(code, oauthState.redirect_uri, codeVerifier)
  const grantedScopes = (token.scope ?? '').split(/\s+/).filter(Boolean)
  if (!REQUIRED_SCOPES.every((scope) => grantedScopes.includes(scope))) {
    await revokeGoogleToken(token.access_token)
    throw new OAuthFlowError('insufficient_scope', 'Required YouTube permission was not granted')
  }

  const youtubeChannel = await fetchYoutubeChannel(token.access_token)
  const admin = getAdminClient()
  const { data: existingChannel, error: existingChannelError } = await admin.database
    .from('youtube_channels')
    .select('id,user_id')
    .eq('youtube_channel_id', youtubeChannel.id)
    .maybeSingle()
  if (existingChannelError) throw new OAuthFlowError('channel_storage_failed', 'Could not check the channel connection')
  if (existingChannel && existingChannel.user_id !== oauthState.user_id) {
    await revokeGoogleToken(token.access_token)
    throw new OAuthFlowError('channel_already_connected', 'This channel belongs to another workspace')
  }

  const thumbnail = youtubeChannel.snippet?.thumbnails?.high?.url
    ?? youtubeChannel.snippet?.thumbnails?.medium?.url
    ?? youtubeChannel.snippet?.thumbnails?.default?.url
    ?? null
  const channelRecord = {
    user_id: oauthState.user_id,
    youtube_channel_id: youtubeChannel.id,
    title: youtubeChannel.snippet?.title ?? 'YouTube channel',
    handle: youtubeChannel.snippet?.customUrl ?? null,
    thumbnail_url: thumbnail,
    uploads_playlist_id: youtubeChannel.contentDetails?.relatedPlaylists?.uploads ?? null,
    country: youtubeChannel.snippet?.country ?? null,
    connection_status: 'active',
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    last_synced_at: new Date().toISOString(),
  }

  let channelId = existingChannel?.id as string | undefined
  if (channelId) {
    const { error } = await admin.database.from('youtube_channels').update(channelRecord).eq('id', channelId)
    if (error) throw new OAuthFlowError('channel_storage_failed', 'Could not update the channel connection')
  } else {
    const { data, error } = await admin.database.from('youtube_channels').insert([channelRecord]).select('id').single()
    if (error || !data?.id) throw new OAuthFlowError('channel_storage_failed', 'Could not create the channel connection')
    channelId = data.id as string
  }

  const { data: previousCredential, error: credentialReadError } = await admin.database
    .from('youtube_channel_credentials')
    .select('refresh_token_ciphertext')
    .eq('channel_id', channelId)
    .maybeSingle()
  if (credentialReadError) throw new OAuthFlowError('credential_storage_failed', 'Could not read stored channel credentials')

  const refreshTokenCiphertext = token.refresh_token
    ? await encryptSecret(token.refresh_token)
    : previousCredential?.refresh_token_ciphertext
  if (!refreshTokenCiphertext) {
    await revokeGoogleToken(token.access_token)
    await admin.database.from('youtube_channels').update({ connection_status: 'refresh_required' }).eq('id', channelId)
    throw new OAuthFlowError('offline_access_missing', 'Google did not return offline access')
  }

  const { error: credentialWriteError } = await admin.database.from('youtube_channel_credentials').upsert({
    channel_id: channelId,
    access_token_ciphertext: await encryptSecret(token.access_token),
    refresh_token_ciphertext: refreshTokenCiphertext,
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    granted_scopes: grantedScopes,
    token_type: token.token_type ?? 'Bearer',
    encryption_key_version: 1,
    last_refresh_error_code: null,
  }, { onConflict: 'channel_id' })
  if (credentialWriteError) {
    await revokeGoogleToken(token.access_token)
    await admin.database.from('youtube_channels').update({ connection_status: 'refresh_required' }).eq('id', channelId)
    throw new OAuthFlowError('credential_storage_failed', 'Could not store channel credentials')
  }

  return Response.redirect(appRedirect(oauthState.return_to, { youtube: 'connected' }), 302)
}

async function disconnectChannel(request: Request, body: Record<string, unknown>) {
  const user = await getAuthenticatedUser(request)
  const channelId = typeof body.channelId === 'string' ? body.channelId : ''
  if (!channelId) throw new OAuthFlowError('invalid_request', 'channelId is required')

  const admin = getAdminClient()
  const { data: channel, error: channelError } = await admin.database
    .from('youtube_channels')
    .select('id')
    .eq('id', channelId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (channelError || !channel) throw new OAuthFlowError('not_found', 'Channel connection not found')

  const { data: credential } = await admin.database
    .from('youtube_channel_credentials')
    .select('access_token_ciphertext,refresh_token_ciphertext')
    .eq('channel_id', channelId)
    .maybeSingle()

  const encryptedToken = credential?.refresh_token_ciphertext ?? credential?.access_token_ciphertext
  if (encryptedToken) {
    try {
      await revokeGoogleToken(await decryptSecret(encryptedToken))
    } catch {
      // Local disconnect must still finish if a stale credential cannot be revoked.
    }
  }

  const { error: credentialDeleteError } = await admin.database
    .from('youtube_channel_credentials')
    .delete()
    .eq('channel_id', channelId)
  if (credentialDeleteError) throw new OAuthFlowError('disconnect_failed', 'Could not remove stored channel credentials')

  const { error: channelUpdateError } = await admin.database
    .from('youtube_channels')
    .update({ connection_status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('id', channelId)
    .eq('user_id', user.id)
  if (channelUpdateError) throw new OAuthFlowError('disconnect_failed', 'Could not update the channel connection')

  return json(request, { disconnected: true })
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin')
    const headers = getCorsHeaders(request)
    if (origin && headers['Access-Control-Allow-Origin'] !== origin) return json(request, { error: 'Origin not allowed' }, 403)
    return new Response(null, { status: 204, headers })
  }

  try {
    if (request.method === 'GET') return await finishConnection(request)
    if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

    const origin = request.headers.get('Origin')
    const headers = getCorsHeaders(request)
    if (origin && headers['Access-Control-Allow-Origin'] !== origin) return json(request, { error: 'Origin not allowed' }, 403)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) throw new OAuthFlowError('invalid_request', 'A JSON request body is required')
    if (body.action === 'start') return await startConnection(request, body)
    if (body.action === 'disconnect') return await disconnectChannel(request, body)
    throw new OAuthFlowError('invalid_request', 'Unknown action')
  } catch (caughtError) {
    const flowError = caughtError instanceof OAuthFlowError
      ? caughtError
      : new OAuthFlowError('unexpected_error', 'Unexpected OAuth error')
    const status = flowError.code === 'unauthorized' ? 401
      : flowError.code === 'not_found' ? 404
      : flowError.code === 'server_not_configured' ? 503
      : 400

    if (request.method === 'GET') {
      try {
        return Response.redirect(appRedirect('/app', { youtube: 'error', reason: flowError.code }), 302)
      } catch {
        return json(request, { error: flowError.code }, status)
      }
    }
    return json(request, { error: flowError.message, code: flowError.code }, status)
  }
}
