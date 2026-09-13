import { describe, expect, it } from 'vitest'
import {
  ACTIVE_UPLOAD_LIMIT_BYTES,
  createAssetObjectKey,
  isYoutubeThumbnailMimeType,
  normalizeYoutubeTags,
  sanitizeUploadFileName,
  STORAGE_BUCKETS,
  utf8ByteLength,
  validateYoutubeMetadata,
  youtubeTagsCharacterLength,
} from './domain'

describe('video domain contract', () => {
  it('keeps the frontend upload limit aligned with InsForge configuration', () => {
    expect(ACTIVE_UPLOAD_LIMIT_BYTES).toBe(200 * 1024 * 1024)
    expect(STORAGE_BUCKETS.video).toBe('video-uploads')
    expect(STORAGE_BUCKETS.thumbnail).toBe('video-thumbnails')
  })

  it('builds an owner-scoped storage key and removes path traversal', () => {
    expect(
      createAssetObjectKey({
        userId: '11111111-1111-1111-1111-111111111111',
        assetId: '22222222-2222-2222-2222-222222222222',
        fileName: '../My Video (Final).mp4',
      }),
    ).toBe(
      '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/my-video-final.mp4',
    )
  })

  it('provides a safe fallback and rejects unsafe ownership segments', () => {
    expect(sanitizeUploadFileName('...')).toBe('upload')
    expect(() =>
      createAssetObjectKey({ userId: '../escape', assetId: 'asset-id', fileName: 'video.mp4' }),
    ).toThrow('userId must be a non-empty storage-safe identifier')
  })

  it('validates YouTube metadata using bytes and API tag accounting', () => {
    expect(utf8ByteLength('🎬')).toBe(4)
    expect(youtubeTagsCharacterLength(['editing', 'creator workflow'])).toBe(26)
    expect(normalizeYoutubeTags('Editing, editing, creator workflow')).toEqual(['Editing', 'creator workflow'])
    expect(validateYoutubeMetadata({ title: 'Valid title', description: '🎬'.repeat(1_251), tags: [] }))
      .toBe('The description must be 5,000 UTF-8 bytes or fewer.')
    expect(validateYoutubeMetadata({ title: 'Invalid <title>', description: '', tags: [] }))
      .toBe('The title cannot contain < or >.')
  })

  it('accepts only YouTube-compatible thumbnail image types', () => {
    expect(isYoutubeThumbnailMimeType('image/jpeg')).toBe(true)
    expect(isYoutubeThumbnailMimeType('image/png')).toBe(true)
    expect(isYoutubeThumbnailMimeType('image/gif')).toBe(false)
  })
})
