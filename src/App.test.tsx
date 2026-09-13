import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './features/publishing/PublishingWorkspace'
import type { VideoPostRecord } from './features/videos/domain'
import type { YoutubeChannel } from './features/youtube/channels'

const { databaseRpc, functionsInvoke, storageFrom } = vi.hoisted(() => ({
  databaseRpc: vi.fn(),
  functionsInvoke: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('./lib/insforge', () => ({
  insforge: {
    database: { from: vi.fn(), rpc: databaseRpc },
    functions: { invoke: functionsInvoke },
    storage: { from: storageFrom },
  },
}))

function renderDashboard(posts: VideoPostRecord[] = [], channels: YoutubeChannel[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  queryClient.setQueryData(['youtube-channels', 'user-123'], channels)
  queryClient.setQueryData(['video-posts', 'user-123', 100], { posts, total: posts.length })
  queryClient.setQueryData(['video-post-counts', 'user-123'], { drafts: posts.filter((post) => post.status === 'draft').length, pipeline: 0, scheduled: 0, published: 0, issues: 0 })
  queryClient.setQueryData(['media-assets', 'user-123', ['asset-123']], [{
    id: 'asset-123',
    url: 'https://storage.example/video.mp4',
    original_filename: 'studio-walkthrough.mp4',
    size_bytes: 1_024,
    status: 'staged',
  }])
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage
        accountEmail="creator@example.com"
        accountLabel="CE"
        onSignOut={() => undefined}
        userId="user-123"
      />
    </QueryClientProvider>,
  )
}

describe('Publishing workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databaseRpc.mockResolvedValue({ data: { video_post_id: 'draft-123', objects: [{ bucket: 'video-uploads', key: 'user-123/asset-123/studio-walkthrough.mp4' }] }, error: null })
    functionsInvoke.mockResolvedValue({ data: { success: true }, error: null })
    storageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({ data: null, error: null }) })
  })

  it('renders a truthful empty queue without fabricated releases', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { name: 'Release desk' })).toBeInTheDocument()
    expect(screen.getByText('No drafts on the workbench')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Drafts/ })).toHaveTextContent('0')
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument()
    expect(screen.getAllByText('No YouTube channel connected').length).toBeGreaterThan(0)
  })

  it('switches the real queue to an empty calendar', async () => {
    const user = userEvent.setup()
    renderDashboard()

    const viewControl = screen.getByLabelText('Release view')
    const calendarButton = within(viewControl).getByRole('button', { name: 'Calendar' })
    await user.click(calendarButton)

    expect(screen.getByText(/^Week of /)).toBeInTheDocument()
    expect(screen.getAllByText('No release')).toHaveLength(7)
    expect(calendarButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports arrow-key navigation across release stages', async () => {
    const user = userEvent.setup()
    renderDashboard()

    const drafts = screen.getByRole('tab', { name: /Drafts/ })
    drafts.focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: /Pipeline/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nothing moving through the pipeline')).toBeInTheDocument()
  })

  it('opens the upload composer from the primary action', async () => {
    const user = userEvent.setup()
    renderDashboard()

    const uploadButtons = screen.getAllByRole('button', { name: 'New upload' })
    await user.click(uploadButtons.at(-1)!)

    expect(await screen.findByRole('dialog', { name: 'Prepare a release' })).toBeInTheDocument()
    expect(screen.getByText('YouTube channel required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save upload draft' })).toBeDisabled()
  })

  it('moves focus into the composer and closes it with Escape', async () => {
    const user = userEvent.setup()
    renderDashboard()
    const trigger = screen.getByRole('button', { name: 'New upload' })

    await user.click(trigger)
    const title = await screen.findByRole('heading', { name: 'Prepare a release' })
    await waitFor(() => expect(title).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('confirms draft deletion and removes its private storage object', async () => {
    const user = userEvent.setup()
    const draft: VideoPostRecord = {
      id: 'draft-123', user_id: 'user-123', channel_id: null, video_asset_id: 'asset-123', thumbnail_asset_id: null,
      title: 'Studio walkthrough', description: '', tags: [], category_id: '22', default_language: null,
      target_privacy_status: 'private', made_for_kids: false, contains_synthetic_media: false,
      notify_subscribers: true, publish_at: null, schedule_timezone: 'UTC', status: 'draft', youtube_video_id: null,
      progress_bytes: 0, last_error_code: null, last_error_message: null,
      created_at: '2026-08-15T00:00:00.000Z', updated_at: '2026-08-15T00:00:00.000Z',
    }
    renderDashboard([draft])

    await user.click(screen.getByRole('button', { name: 'Delete Studio walkthrough' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this draft?' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Keep draft' })).toHaveFocus())
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }))

    await waitFor(() => expect(databaseRpc).toHaveBeenCalledWith('delete_video_draft', { p_video_post_id: 'draft-123' }))
    expect(storageFrom).toHaveBeenCalledWith('video-uploads')
    expect(await screen.findByRole('status')).toHaveTextContent('Draft and its private media were deleted.')
  })

  it('requires confirmation before revoking a YouTube connection', async () => {
    const user = userEvent.setup()
    const channel: YoutubeChannel = {
      id: 'channel-123', youtube_channel_id: 'UC123', title: 'Creator channel', handle: '@creator',
      thumbnail_url: null, connection_status: 'active', connected_at: '2026-08-15T00:00:00.000Z', last_synced_at: null,
    }
    renderDashboard([], [channel])

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const confirmation = screen.getByRole('group', { name: 'Disconnect Creator channel?' })
    expect(functionsInvoke).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'Disconnect channel' }))

    await waitFor(() => expect(functionsInvoke).toHaveBeenCalledWith('youtube-oauth', {
      body: { action: 'disconnect', channelId: 'channel-123' },
    }))
  })
})
