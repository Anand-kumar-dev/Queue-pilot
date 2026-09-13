export const STORAGE_BUCKETS = {
  video: 'video-uploads',
  thumbnail: 'video-thumbnails',
} as const

export const ACTIVE_UPLOAD_LIMIT_MB = 200
export const ACTIVE_UPLOAD_LIMIT_BYTES = ACTIVE_UPLOAD_LIMIT_MB * 1024 * 1024
export const YOUTUBE_MAX_FILE_BYTES = 256 * 1024 * 1024 * 1024
export const YOUTUBE_MAX_DURATION_SECONDS = 12 * 60 * 60
export const YOUTUBE_TITLE_MAX_CHARACTERS = 100
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5_000
export const YOUTUBE_TAGS_MAX_CHARACTERS = 500
export const YOUTUBE_TAGS_MAX_COUNT = 100
export const YOUTUBE_THUMBNAIL_MIME_TYPES = ['image/jpeg', 'image/png'] as const

export const VIDEO_POST_STATUSES = [
  'draft',
  'queued',
  'uploading',
  'processing',
  'scheduled',
  'published',
  'failed',
  'cancelled',
] as const

export type VideoPostStatus = (typeof VIDEO_POST_STATUSES)[number]
export type MediaAssetKind = keyof typeof STORAGE_BUCKETS
export type TargetPrivacyStatus = 'private' | 'unlisted' | 'public'

const STORAGE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/

function assertStorageSegment(value: string, label: string) {
  if (!STORAGE_SEGMENT_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-empty storage-safe identifier`)
  }
}

export function sanitizeUploadFileName(fileName: string) {
  const basename = fileName.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const sanitized = basename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120)

  return sanitized || 'upload'
}

export function createAssetObjectKey(input: {
  userId: string
  assetId: string
  fileName: string
}) {
  assertStorageSegment(input.userId, 'userId')
  assertStorageSegment(input.assetId, 'assetId')

  return `${input.userId}/${input.assetId}/${sanitizeUploadFileName(input.fileName)}`
}

export function unicodeCharacterLength(value: string) {
  return Array.from(value).length
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function normalizeYoutubeTags(value: string) {
  const seen = new Set<string>()

  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false
      const comparisonKey = tag.toLocaleLowerCase()
      if (seen.has(comparisonKey)) return false
      seen.add(comparisonKey)
      return true
    })
}

export function youtubeTagsCharacterLength(tags: string[]) {
  return tags.reduce((length, tag, index) => {
    const quotedTagLength = /\s/.test(tag) ? unicodeCharacterLength(tag) + 2 : unicodeCharacterLength(tag)
    return length + quotedTagLength + (index > 0 ? 1 : 0)
  }, 0)
}

export function validateYoutubeMetadata(input: {
  title: string
  description: string
  tags: string[]
}) {
  const title = input.title.trim()

  if (!title) return 'Add a title.'
  if (unicodeCharacterLength(title) > YOUTUBE_TITLE_MAX_CHARACTERS) {
    return `The title must be ${YOUTUBE_TITLE_MAX_CHARACTERS} characters or fewer.`
  }
  if (/[<>]/.test(title)) return 'The title cannot contain < or >.'
  if (utf8ByteLength(input.description) > YOUTUBE_DESCRIPTION_MAX_BYTES) {
    return `The description must be ${YOUTUBE_DESCRIPTION_MAX_BYTES.toLocaleString()} UTF-8 bytes or fewer.`
  }
  if (/[<>]/.test(input.description)) return 'The description cannot contain < or >.'
  if (input.tags.length > YOUTUBE_TAGS_MAX_COUNT) {
    return `Use no more than ${YOUTUBE_TAGS_MAX_COUNT} tags.`
  }
  if (youtubeTagsCharacterLength(input.tags) > YOUTUBE_TAGS_MAX_CHARACTERS) {
    return `Tags must use ${YOUTUBE_TAGS_MAX_CHARACTERS} characters or fewer in total.`
  }

  return null
}

export function isYoutubeThumbnailMimeType(value: string): value is (typeof YOUTUBE_THUMBNAIL_MIME_TYPES)[number] {
  return YOUTUBE_THUMBNAIL_MIME_TYPES.includes(value as (typeof YOUTUBE_THUMBNAIL_MIME_TYPES)[number])
}

export interface MediaAssetRecord {
  id: string
  user_id: string
  kind: MediaAssetKind
  bucket: (typeof STORAGE_BUCKETS)[MediaAssetKind]
  key: string
  url: string
  original_filename: string
  mime_type: string
  size_bytes: number
  duration_seconds: number | null
  width: number | null
  height: number | null
  checksum_sha256: string | null
  status: 'staged' | 'ready' | 'failed' | 'deleting' | 'deleted'
  failure_code: string | null
  created_at: string
  updated_at: string
}

export interface VideoPostRecord {
  id: string
  user_id: string
  channel_id: string | null
  video_asset_id: string | null
  thumbnail_asset_id: string | null
  title: string
  description: string
  tags: string[]
  category_id: string
  default_language: string | null
  target_privacy_status: TargetPrivacyStatus
  made_for_kids: boolean | null
  contains_synthetic_media: boolean
  notify_subscribers: boolean
  publish_at: string | null
  schedule_timezone: string
  status: VideoPostStatus
  youtube_video_id: string | null
  progress_bytes: number
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}
