import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadComposer } from './UploadComposer'
import type { VideoPostRecord } from './domain'

const { databaseFrom, databaseRpc, storageFrom } = vi.hoisted(() => ({
  databaseFrom: vi.fn(),
  databaseRpc: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('../../lib/insforge', () => ({
  insforge: {
    database: { from: databaseFrom, rpc: databaseRpc },
    storage: { from: storageFrom },
  },
}))

function renderComposer(draft?: VideoPostRecord) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(['youtube-channels', 'user-123'], [{
    id: 'channel-123',
    youtube_channel_id: 'UC123',
    title: 'Creator channel',
    handle: '@creator',
    thumbnail_url: null,
    connection_status: 'active',
    connected_at: '2026-08-15T00:00:00.000Z',
    last_synced_at: null,
  }])
  queryClient.setQueryData(['video-posts', 'user-123', 100], { posts: [], total: 0 })
  const onClose = vi.fn()
  const onSaved = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <UploadComposer draft={draft} onClose={onClose} onSaved={onSaved} open sourceAsset={draft ? { original_filename: 'stored-video.mp4', size_bytes: 1_024 } : undefined} userId="user-123" />
    </QueryClientProvider>,
  )

  return { onClose, onSaved }
}

describe('UploadComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databaseRpc.mockResolvedValue({ data: { id: 'draft-123' }, error: null })
    databaseFrom.mockImplementation(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }))
    storageFrom.mockImplementation(() => ({
      upload: vi.fn().mockImplementation(async (key: string) => ({ data: { key, url: `https://storage.example/${key}` }, error: null })),
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    }))
  })

  it('uploads the selected video and creates a channel-owned draft', async () => {
    const user = userEvent.setup()
    const { onClose, onSaved } = renderComposer()
    const video = new File(['video-bytes'], 'studio-walkthrough.mp4', { type: 'video/mp4' })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]')!

    await user.upload(fileInput, video)
    await user.click(screen.getByRole('radio', { name: 'No, it is not made for kids' }))
    await user.click(screen.getByRole('checkbox', { name: /I confirm that this upload follows/i }))
    await user.click(screen.getByRole('button', { name: 'Schedule for YouTube' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(storageFrom).toHaveBeenCalledWith('video-uploads')

    expect(databaseRpc).toHaveBeenCalledWith('create_video_draft', expect.objectContaining({
      p_channel_id: 'channel-123',
      p_title: 'studio walkthrough',
      p_video_asset: expect.objectContaining({ bucket: 'video-uploads', original_filename: 'studio-walkthrough.mp4' }),
    }))
    expect(databaseFrom).not.toHaveBeenCalledWith('media_assets')
  })

  it('rejects a file above the active InsForge limit before uploading', () => {
    renderComposer()
    const oversizedVideo = new File(['x'], 'too-large.mp4', { type: 'video/mp4' })
    Object.defineProperty(oversizedVideo, 'size', { value: 201 * 1024 * 1024 })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]')!

    fireEvent.change(fileInput, { target: { files: [oversizedVideo] } })

    expect(screen.getByRole('alert')).toHaveTextContent('currently accepts files up to 200 MB')
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('rejects thumbnail formats that the YouTube API does not accept', () => {
    renderComposer()
    const gif = new File(['gif-bytes'], 'animated.gif', { type: 'image/gif' })
    const thumbnailInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/jpeg,image/png"]')!

    fireEvent.change(thumbnailInput, { target: { files: [gif] } })

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG or PNG image')
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('validates the YouTube description byte limit before uploading', async () => {
    const user = userEvent.setup()
    renderComposer()
    const video = new File(['video-bytes'], 'studio-walkthrough.mp4', { type: 'video/mp4' })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]')!

    await user.upload(fileInput, video)
    await user.click(screen.getByRole('radio', { name: 'No, it is not made for kids' }))
    await user.click(screen.getByRole('checkbox', { name: /I confirm that this upload follows/i }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '🎬'.repeat(1_251) } })
    await user.click(screen.getByRole('button', { name: 'Schedule for YouTube' }))

    expect(screen.getByRole('alert')).toHaveTextContent('5,000 UTF-8 bytes')
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('updates draft metadata without uploading the stored source again', async () => {
    const user = userEvent.setup()
    const draft: VideoPostRecord = {
      id: 'draft-123',
      user_id: 'user-123',
      channel_id: 'channel-123',
      video_asset_id: 'asset-123',
      thumbnail_asset_id: null,
      title: 'Stored release',
      description: 'Existing description',
      tags: ['workflow'],
      category_id: '22',
      default_language: null,
      target_privacy_status: 'private',
      made_for_kids: false,
      contains_synthetic_media: false,
      notify_subscribers: true,
      publish_at: null,
      schedule_timezone: 'UTC',
      status: 'draft',
      youtube_video_id: null,
      progress_bytes: 0,
      last_error_code: null,
      last_error_message: null,
      created_at: '2026-08-15T00:00:00.000Z',
      updated_at: '2026-08-15T00:00:00.000Z',
    }
    const { onSaved } = renderComposer(draft)

    expect(screen.getByRole('heading', { name: 'Edit release' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Updated release')
    await user.click(screen.getByRole('checkbox', { name: /I confirm that this upload follows/i }))
    await user.click(screen.getByRole('button', { name: 'Save release changes' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(storageFrom).not.toHaveBeenCalled()
  })
})
