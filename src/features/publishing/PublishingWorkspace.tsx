import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  CircleX,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileVideo2,
  LayoutList,
  LoaderCircle,
  LogOut,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Tags,
  Trash2,
  RotateCcw,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { toUserErrorMessage } from '../../lib/errors'
import { insforge } from '../../lib/insforge'
import { UploadComposer } from '../videos/UploadComposer'
import { STORAGE_BUCKETS, type MediaAssetRecord, type VideoPostRecord, type VideoPostStatus } from '../videos/domain'
import { ConnectYouTubeCard } from '../youtube/ConnectYouTubeCard'
import { useYoutubeChannels, type YoutubeChannel } from '../youtube/channels'

type ReleaseLane = 'drafts' | 'pipeline' | 'scheduled' | 'published' | 'issues'
type ReleaseView = 'list' | 'calendar'

const VIDEO_POST_FIELDS = 'id,user_id,channel_id,video_asset_id,thumbnail_asset_id,title,description,tags,category_id,default_language,target_privacy_status,made_for_kids,contains_synthetic_media,notify_subscribers,publish_at,schedule_timezone,status,youtube_video_id,progress_bytes,last_error_code,last_error_message,created_at,updated_at'
const EMPTY_POSTS: VideoPostRecord[] = []
const DEFAULT_POST_LIMIT = 100

type MediaAssetListRecord = Pick<MediaAssetRecord, 'id' | 'url' | 'original_filename' | 'size_bytes' | 'status'>
type DeletedStorageObject = { bucket: string; key: string }

interface DeleteDraftResult {
  video_post_id: string
  objects: DeletedStorageObject[]
}

const LANE_STATUSES: Record<ReleaseLane, VideoPostStatus[]> = {
  drafts: ['draft'],
  pipeline: ['queued', 'uploading', 'processing', 'ready'],
  scheduled: ['scheduled'],
  published: ['published'],
  issues: ['failed', 'cancelled'],
}

const LANE_COPY: Record<ReleaseLane, { label: string; eyebrow: string; emptyTitle: string; emptyBody: string }> = {
  drafts: {
    label: 'Drafts',
    eyebrow: '01 / Workbench',
    emptyTitle: 'No drafts on the workbench',
    emptyBody: 'Videos saved through QueuePilot stay here until you submit them to the publishing pipeline.',
  },
  pipeline: {
    label: 'Pipeline',
    eyebrow: '02 / Transfer',
    emptyTitle: 'Nothing moving through the pipeline',
    emptyBody: 'Queued, uploading, and YouTube-processing releases appear here with their real transfer state.',
  },
  scheduled: {
    label: 'Scheduled',
    eyebrow: '03 / Release',
    emptyTitle: 'No YouTube-confirmed releases',
    emptyBody: 'A release appears here only after YouTube confirms its private video and publish time.',
  },
  published: {
    label: 'Published',
    eyebrow: '04 / Live log',
    emptyTitle: 'No releases published by QueuePilot',
    emptyBody: 'Existing YouTube Studio history is not imported. This log contains only QueuePilot-confirmed publications.',
  },
  issues: {
    label: 'Issues',
    eyebrow: '05 / Attention',
    emptyTitle: 'No release issues',
    emptyBody: 'Failed and cancelled work appears here with the persisted cause and a safe recovery path.',
  },
}

const STATUS_STYLE: Record<VideoPostStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'text-paper-ink/55' },
  queued: { label: 'Queued', className: 'text-status-paper-upload' },
  uploading: { label: 'Uploading', className: 'text-status-paper-upload' },
  processing: { label: 'Processing', className: 'text-status-paper-warning' },
  ready: { label: 'Ready on YouTube', className: 'text-status-paper-ready' },
  scheduled: { label: 'Scheduled', className: 'text-status-paper-ready' },
  published: { label: 'Published', className: 'text-status-paper-ready' },
  failed: { label: 'Failed', className: 'text-status-paper-danger' },
  cancelled: { label: 'Cancelled', className: 'text-paper-ink/55' },
}

async function fetchVideoPosts(limit: number) {
  const { data, error, count } = await insforge.database
    .from('video_posts')
    .select(VIDEO_POST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  const posts = (data ?? []) as VideoPostRecord[]
  return { posts, total: count ?? posts.length }
}

async function fetchVideoPostCounts() {
  const entries = await Promise.all((Object.keys(LANE_STATUSES) as ReleaseLane[]).map(async (lane) => {
    const { count, error } = await insforge.database
      .from('video_posts')
      .select('id', { count: 'exact' })
      .in('status', LANE_STATUSES[lane])
      .limit(1)
    if (error) throw error
    return [lane, count ?? 0] as const
  }))

  return Object.fromEntries(entries) as Record<ReleaseLane, number>
}

async function fetchMediaAssets(assetIds: string[]) {
  if (assetIds.length === 0) return []
  const { data, error } = await insforge.database
    .from('media_assets')
    .select('id,url,original_filename,size_bytes,status')
    .in('id', assetIds)
    .limit(assetIds.length)

  if (error) throw error
  return (data ?? []) as MediaAssetListRecord[]
}

function readDeletedStorageObjects(value: unknown, userId: string) {
  const result = (Array.isArray(value) ? value[0] : value) as Partial<DeleteDraftResult> | null
  if (!result || !Array.isArray(result.objects)) return []
  const allowedBuckets = new Set<string>(Object.values(STORAGE_BUCKETS))

  return result.objects.filter((object): object is DeletedStorageObject => (
    typeof object?.bucket === 'string'
    && allowedBuckets.has(object.bucket)
    && typeof object.key === 'string'
    && object.key.startsWith(`${userId}/`)
  ))
}

function RunwayMark() {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand shadow-[0_0_0_5px_rgba(216,173,103,0.12)]" aria-hidden="true">
      <svg className="size-6" fill="none" viewBox="0 0 24 24">
        <path d="M4 6.5h8.5L19 12" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M4 12h10" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M4 17.5h8.5L19 12" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
        <circle cx="19" cy="12" fill="#20170d" r="2.25" />
      </svg>
    </span>
  )
}

function Masthead({
  accountEmail,
  accountLabel,
  onNewUpload,
  onSignOut,
}: {
  accountEmail: string
  accountLabel: string
  onNewUpload: () => void
  onSignOut: () => void | Promise<void>
}) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-7">
        <div className="flex min-w-0 items-center gap-3 lg:hidden">
          <RunwayMark />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-[-0.02em] text-ink">QueuePilot</p>
            <p className="hidden font-mono text-[9px] uppercase tracking-[0.11em] text-muted sm:block">release operations</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 lg:block">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search your workspace</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-soft" />
            <input className="h-8 w-full rounded-md border border-border bg-app pl-8 pr-3 text-[11px] text-text-soft outline-none placeholder:text-muted-soft focus:border-brand" placeholder="Search posts, ideas, or anything…" type="search" />
          </label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button aria-label="Create post" className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[12px] font-semibold text-brand-ink transition-colors hover:bg-brand-hover" onClick={onNewUpload} type="button">
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Create post</span>
            <span className="sm:hidden">Create</span>
          </button>
          <div className="ml-1 hidden items-center gap-2.5 border-l border-border pl-3 md:flex">
            <span className="grid size-8 place-items-center rounded-full border border-border bg-surface-raised text-[10px] font-semibold text-text-soft">{accountLabel}</span>
            <p className="max-w-44 truncate text-[11px] text-muted">{accountEmail}</p>
          </div>
          <button aria-label="Sign out" className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-subtle hover:text-ink" onClick={() => void onSignOut()} type="button">
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}

function WorkspaceSidebar({
  accountEmail,
  accountLabel,
  channelCount,
  onNewUpload,
  onSignOut,
  setView,
  view,
}: {
  accountEmail: string
  accountLabel: string
  channelCount: number
  onNewUpload: () => void
  onSignOut: () => void | Promise<void>
  setView: (view: ReleaseView) => void
  view: ReleaseView
}) {
  const navItem = (active: boolean) => cn(
    'flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] font-medium transition-colors',
    active ? 'bg-surface-subtle text-ink' : 'text-muted hover:bg-surface-raised hover:text-ink',
  )

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-rail p-4 lg:flex">
      <div className="flex items-center gap-3 px-2 py-2">
        <RunwayMark />
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-ink">QueuePilot</p>
        </div>
      </div>

      <button className="mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-3 text-[13px] font-semibold text-brand-ink transition-all hover:bg-brand-hover active:scale-[0.98]" onClick={onNewUpload} type="button">
        <Plus className="size-4" aria-hidden="true" />
        Create post
      </button>

      <nav className="mt-5" aria-label="Workspace navigation">
        <div className="grid gap-1">
          <button aria-current={view === 'calendar' ? 'page' : undefined} className={navItem(view === 'calendar')} onClick={() => setView('calendar')} type="button">
            <CalendarDays className="size-4" aria-hidden="true" />
            Calendar
          </button>
          <button aria-current={view === 'list' ? 'page' : undefined} className={navItem(view === 'list')} onClick={() => setView('list')} type="button">
            <FileVideo2 className="size-4" aria-hidden="true" />
            Releases
          </button>
        </div>
      </nav>

      <div className="mt-8">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-soft">Channel</p>
        <div className="rounded-lg border border-border bg-surface-raised p-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-app text-[9px] font-semibold text-brand">YT</span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">YouTube</p>
              <p className="mt-0.5 text-[12px] text-muted">{channelCount} {channelCount === 1 ? 'channel' : 'channels'} connected</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-full bg-app text-[10px] font-semibold text-brand">{accountLabel}</span>
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted">{accountEmail}</p>
          <button aria-label="Sign out" className="icon-button size-8" onClick={() => void onSignOut()} type="button"><LogOut className="size-3.5" /></button>
        </div>
      </div>
    </aside>
  )
}

function StageRail({ activeLane, counts, setActiveLane }: { activeLane: ReleaseLane; counts: Record<ReleaseLane, number>; setActiveLane: (lane: ReleaseLane) => void }) {
  const lanes = Object.keys(LANE_COPY) as ReleaseLane[]
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function moveFocus(nextIndex: number) {
    const lane = lanes[(nextIndex + lanes.length) % lanes.length]
    setActiveLane(lane)
    window.requestAnimationFrame(() => tabRefs.current[(nextIndex + lanes.length) % lanes.length]?.focus())
  }

  return (
    <div className="overflow-x-auto" role="tablist" aria-label="Release stages" aria-orientation="horizontal">
      <div className="grid min-w-[700px] grid-cols-5 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,30,43,0.04)]">
        {lanes.map((lane, index) => (
          <button
            aria-controls="release-ledger-panel"
            aria-selected={activeLane === lane}
            className={cn(
              'group relative flex min-h-[56px] items-center gap-3 border-r border-border px-4 text-left last:border-r-0 transition-colors',
              activeLane === lane ? 'bg-surface-subtle text-ink' : 'text-muted hover:bg-surface-raised hover:text-text-soft',
            )}
            id={`release-lane-${lane}`}
            key={lane}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                moveFocus(index + 1)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                moveFocus(index - 1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                moveFocus(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                moveFocus(lanes.length - 1)
              }
            }}
            onClick={() => setActiveLane(lane)}
            ref={(element) => { tabRefs.current[index] = element }}
            role="tab"
            tabIndex={activeLane === lane ? 0 : -1}
            type="button"
          >
            {activeLane === lane ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
            <span className="text-[13px] font-medium">{LANE_COPY[lane].label}</span>
            <span className={cn('ml-auto text-[12px] font-medium', activeLane === lane ? 'text-brand' : 'text-muted-soft')}>{counts[lane]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PublishingSummary({ counts, onSelectLane }: { counts: Record<ReleaseLane, number>; onSelectLane: (lane: ReleaseLane) => void }) {
  const cards: Array<{ lane: ReleaseLane; icon: typeof FileVideo2; note: string }> = [
    { lane: 'drafts', icon: FileVideo2, note: 'Start creating' },
    { lane: 'scheduled', icon: Clock3, note: 'On the calendar' },
    { lane: 'published', icon: Send, note: 'Live on YouTube' },
    { lane: 'issues', icon: CircleX, note: 'Needs attention' },
  ]

  return (
    <section aria-label="Publishing summary" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ lane, icon: Icon, note }) => (
        <button className={cn('group flex min-h-[78px] items-center gap-3 rounded-lg border border-border bg-surface px-4 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:bg-surface-raised', lane === 'drafts' && 'border-brand/30 bg-[#2b2417]')} key={lane} onClick={() => onSelectLane(lane)} type="button">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-md border border-border bg-app text-muted transition-colors group-hover:text-brand', lane === 'drafts' && 'border-brand/30 bg-brand/10 text-brand')}><Icon className="size-4" strokeWidth={1.7} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">{LANE_COPY[lane].label}</span>
            <span className="mt-0.5 block text-[11px] text-muted">{note}</span>
          </span>
          <span className="text-[22px] font-semibold tracking-[-0.04em] text-ink">{counts[lane]}</span>
        </button>
      ))}
    </section>
  )
}

function WorkspaceQuickActions({ onNewUpload, onShowReleases }: { onNewUpload: () => void; onShowReleases: () => void }) {
  return (
    <section className="app-panel mt-4 overflow-hidden rounded-xl" aria-labelledby="quick-actions-heading">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink" id="quick-actions-heading">Quick actions</h2>
      </div>
      <div className="p-2">
        <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-medium text-text-soft transition-colors hover:bg-surface-raised hover:text-ink" onClick={onNewUpload} type="button"><span className="grid size-6 place-items-center rounded-md bg-brand text-brand-ink"><Plus className="size-3.5" /></span>Create a post</button>
        <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-medium text-text-soft transition-colors hover:bg-surface-raised hover:text-ink" onClick={onShowReleases} type="button"><span className="grid size-6 place-items-center rounded-md bg-surface-subtle text-brand"><FileVideo2 className="size-3.5" /></span>View release queue</button>
      </div>
    </section>
  )
}

function ChannelAvatar({ channel }: { channel?: YoutubeChannel }) {
  if (channel?.thumbnail_url) return <img alt="" className="size-6 rounded-full border border-black/10 object-cover" src={channel.thumbnail_url} />
  return <span className="grid size-6 place-items-center rounded-full bg-paper-ink text-paper"><Play className="size-2.5" fill="currentColor" /></span>
}

function humanFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function VideoThumbnail({ post, thumbnail }: { post: VideoPostRecord; thumbnail?: MediaAssetListRecord }) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[5px] bg-paper-ink sm:w-36">
      {thumbnail?.url && !imageFailed ? (
        <img
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setImageFailed(true)}
          src={thumbnail.url}
        />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 h-[38%] border-t border-white/10 bg-[#20211e]" />
      <span className="absolute left-2.5 top-2 font-mono text-[8px] uppercase tracking-[0.08em] text-white/45">{post.target_privacy_status}</span>
      <Play className="absolute left-1/2 top-[45%] size-4 -translate-x-1/2 -translate-y-1/2 text-white/25" fill="currentColor" />
      <span className="absolute bottom-2 left-2.5 h-0.5 w-9 bg-brand" />
    </div>
  )
}

function recordTime(post: VideoPostRecord, timezone: string) {
  const source = post.publish_at ?? post.created_at
  const date = new Date(source)
  const label = post.status === 'scheduled'
    ? 'Confirmed'
    : post.status === 'published'
      ? 'Published'
      : post.publish_at
        ? 'Target'
        : 'Saved'
  return {
    label,
    day: new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', timeZone: timezone }).format(date),
    time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date),
  }
}

function ReleaseList({
  assets,
  channels,
  lane,
  onDeletePost,
  onEditPost,
  onNewUpload,
  onCancelPost,
  onQueuePost,
  onRetryPost,
  publishingActionPostId,
  queueingPostId,
  posts,
  timezone,
}: {
  assets: Map<string, MediaAssetListRecord>
  channels: YoutubeChannel[]
  lane: ReleaseLane
  onDeletePost: (postId: string) => void
  onEditPost: (postId: string) => void
  onNewUpload: () => void
  onCancelPost: (postId: string) => void
  onQueuePost: (postId: string) => void
  onRetryPost: (postId: string) => void
  posts: VideoPostRecord[]
  publishingActionPostId: string | null
  queueingPostId: string | null
  timezone: string
}) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]))

  if (posts.length === 0) {
    const copy = LANE_COPY[lane]
    return (
      <div className="grid min-h-[420px] place-items-center px-6 py-16 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-[7px] border border-paper-line bg-paper-raised text-paper-ink/45"><FileVideo2 className="size-5" strokeWidth={1.5} /></span>
          <h2 className="mt-5 text-[18px] font-medium tracking-[-0.02em] text-paper-ink">{copy.emptyTitle}</h2>
          <p className="mt-2 text-[13px] leading-6 text-paper-ink/55">{copy.emptyBody}</p>
          {lane === 'drafts' || lane === 'pipeline' ? <button className="mt-5 inline-flex h-10 items-center gap-2 rounded-[7px] bg-paper-ink px-4 text-[13px] font-medium text-paper transition-colors hover:bg-black" onClick={onNewUpload} type="button"><Plus className="size-4" />Prepare upload</button> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y divide-paper-line">
      {posts.map((post) => {
        const channel = post.channel_id ? channelMap.get(post.channel_id) : undefined
        const thumbnail = post.thumbnail_asset_id ? assets.get(post.thumbnail_asset_id) : undefined
        const videoAsset = post.video_asset_id ? assets.get(post.video_asset_id) : undefined
        const timing = recordTime(post, timezone)
        const status = STATUS_STYLE[post.status]
        const progressPercent = videoAsset?.size_bytes
          ? Math.min(100, Math.round((post.progress_bytes / videoAsset.size_bytes) * 100))
          : 0
        return (
          <article className="release-row grid gap-4 px-4 py-4 hover:bg-paper-raised sm:px-5 xl:grid-cols-[minmax(360px,1fr)_150px_130px] xl:items-center" key={post.id}>
            <div className="flex min-w-0 items-center gap-3.5">
              <VideoThumbnail post={post} thumbnail={thumbnail} />
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-semibold tracking-[-0.015em] text-paper-ink">{post.title || 'Untitled upload'}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-paper-ink/55">
                  <span className="inline-flex min-w-0 items-center gap-1.5"><ChannelAvatar channel={channel} /><span className="max-w-40 truncate">{channel?.title ?? 'Channel unavailable'}</span></span>
                  <span className="capitalize">{post.target_privacy_status}</span>
                  {videoAsset ? <span className="font-mono text-[9px]">{humanFileSize(videoAsset.size_bytes)}</span> : null}
                  {post.tags.length > 0 ? <span className="truncate">{post.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</span> : null}
                </div>
                {post.status === 'uploading' && videoAsset ? (
                  <div className="mt-3 max-w-xs" aria-label={`Upload ${progressPercent}% complete`} role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progressPercent}>
                    <div className="h-1 overflow-hidden bg-paper-line"><div className="h-full bg-status-paper-upload" style={{ width: `${progressPercent}%` }} /></div>
                    <p className="mt-1 font-mono text-[8px] text-paper-ink/45">{humanFileSize(post.progress_bytes)} / {humanFileSize(videoAsset.size_bytes)}</p>
                  </div>
                ) : null}
                {post.last_error_message ? <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-status-paper-danger">{post.last_error_message}</p> : null}
              </div>
            </div>

            <div className="grid grid-cols-[86px_1fr] gap-2 text-[12px] xl:block">
              <span className="text-paper-ink/45 xl:hidden">{timing.label}</span>
            <p className="text-[11px] font-medium text-paper-ink/55">{timing.label}</p>
              <p className="mt-1 font-medium text-paper-ink/75">{timing.day} · {timing.time}</p>
              <p className="mt-0.5 font-mono text-[8px] text-paper-ink/40">{timezone.replaceAll('_', ' ')}</p>
            </div>

            <div className="grid grid-cols-[86px_1fr] items-center gap-2 xl:block">
              <span className="text-[12px] text-paper-ink/45 xl:hidden">State</span>
              <span className={cn('inline-flex w-fit items-center gap-2 text-[11px] font-medium', status.className)}><span className="status-dot-live size-1.5 rounded-full bg-current" />{status.label}</span>
              {post.status === 'draft' ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[5px] bg-paper-ink px-2.5 text-[11px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60" disabled={queueingPostId !== null} onClick={() => onQueuePost(post.id)} type="button">
                    {queueingPostId === post.id ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <Send className="size-3" aria-hidden="true" />}
                    {queueingPostId === post.id ? 'Queuing…' : 'Queue for YouTube'}
                  </button>
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-paper-line bg-paper-raised px-2.5 text-[11px] font-medium text-paper-ink/70 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => onEditPost(post.id)} type="button"><Pencil className="size-3" aria-hidden="true" />Edit</button>
                  <button aria-label={`Delete ${post.title || 'untitled draft'}`} className="inline-flex size-8 items-center justify-center rounded-[5px] border border-paper-line bg-paper-raised text-paper-ink/45 transition-colors hover:border-status-paper-danger/30 hover:bg-status-paper-danger/5 hover:text-status-paper-danger" onClick={() => onDeletePost(post.id)} type="button"><Trash2 className="size-3.5" aria-hidden="true" /></button>
                </div>
              ) : null}
              {post.status === 'queued' ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-paper-line bg-paper-raised px-2.5 text-[11px] font-medium text-paper-ink/70 transition-colors hover:border-status-paper-danger/30 hover:bg-status-paper-danger/5 hover:text-status-paper-danger disabled:cursor-wait disabled:opacity-60" disabled={publishingActionPostId !== null} onClick={() => onCancelPost(post.id)} type="button">
                    {publishingActionPostId === post.id ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <CircleX className="size-3" aria-hidden="true" />}
                    {publishingActionPostId === post.id ? 'Cancelling…' : 'Cancel queue'}
                  </button>
                </div>
              ) : null}
              {post.status === 'failed' ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-paper-line bg-paper-raised px-2.5 text-[11px] font-medium text-paper-ink/70 transition-colors hover:bg-paper-soft hover:text-paper-ink disabled:cursor-wait disabled:opacity-60" disabled={publishingActionPostId !== null} onClick={() => onRetryPost(post.id)} type="button">
                    {publishingActionPostId === post.id ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3" aria-hidden="true" />}
                    {publishingActionPostId === post.id ? 'Retrying…' : 'Retry transfer'}
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function DeleteDraftDialog({
  busy,
  error,
  onCancel,
  onConfirm,
  post,
  sourceAsset,
}: {
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  post: VideoPostRecord
  sourceAsset?: MediaAssetListRecord
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(busy)
  const onCancelRef = useRef(onCancel)
  busyRef.current = busy
  onCancelRef.current = onCancel

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }} role="presentation">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-[12px] bg-paper text-paper-ink shadow-2xl"
        ref={dialogRef}
        role="alertdialog"
      >
        <header className="flex items-start gap-4 border-b border-paper-line px-5 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-status-paper-danger/10 text-status-paper-danger"><Trash2 className="size-4.5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-paper-ink/40">Permanent action</p>
            <h2 className="mt-1 text-[19px] font-medium tracking-[-0.025em]" id={titleId}>Delete this draft?</h2>
          </div>
          <button aria-label="Close delete confirmation" className="grid size-9 shrink-0 place-items-center rounded-[6px] text-paper-ink/40 hover:bg-paper-soft hover:text-paper-ink" disabled={busy} onClick={onCancel} type="button"><X className="size-4" aria-hidden="true" /></button>
        </header>
        <div className="px-5 py-5">
          <p className="truncate text-[14px] font-semibold">{post.title || 'Untitled upload'}</p>
          <p className="mt-1 font-mono text-[9px] text-paper-ink/45">{sourceAsset ? `${sourceAsset.original_filename} · ${humanFileSize(sourceAsset.size_bytes)}` : 'Stored source media'}</p>
          <p className="mt-4 text-[12px] leading-5 text-paper-ink/60" id={descriptionId}>This removes the QueuePilot draft and releases its private uploaded media. This action cannot be undone.</p>
          {error ? <p className="mt-4 border-l-2 border-status-paper-danger bg-status-paper-danger/5 px-3 py-2.5 text-[12px] leading-5 text-status-paper-danger" role="alert">{error}</p> : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-paper-line bg-paper-soft px-5 py-4 sm:flex-row sm:justify-end">
          <button className="h-10 rounded-[7px] border border-paper-line bg-paper-raised px-4 text-[12px] font-medium text-paper-ink/65 hover:bg-paper" disabled={busy} onClick={onCancel} ref={cancelButtonRef} type="button">Keep draft</button>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-[7px] bg-status-paper-danger px-4 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={() => void onConfirm()} type="button">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
            {busy ? 'Deleting draft…' : 'Delete draft'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LedgerSkeleton() {
  return (
    <div aria-label="Reading the release ledger" aria-live="polite" role="status">
      {[0, 1, 2].map((row) => (
        <div className="flex animate-pulse items-center gap-4 border-b border-paper-line px-4 py-4 last:border-b-0 sm:px-5" key={row}>
          <div className="aspect-video w-28 shrink-0 rounded-[5px] bg-paper-soft sm:w-36" />
          <div className="flex-1">
            <div className="h-3 w-2/5 rounded-sm bg-paper-soft" />
            <div className="mt-3 h-2.5 w-3/5 rounded-sm bg-paper-soft" />
          </div>
          <div className="hidden h-3 w-20 rounded-sm bg-paper-soft sm:block" />
        </div>
      ))}
      <span className="sr-only">Loading releases…</span>
    </div>
  )
}

function dateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: timezone }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function startOfCurrentWeek(offset = 0) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  start.setDate(start.getDate() + offset * 7)
  return start
}

function timeOfDayInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: timezone,
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { hour: value('hour'), minute: value('minute') }
}

function ReleaseCalendar({ onNewUpload, posts, timezone }: { onNewUpload: () => void; posts: VideoPostRecord[]; timezone: string }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const calendarStartHour = 9
  const calendarEndHour = 21
  const calendarHours = Array.from({ length: calendarEndHour - calendarStartHour + 1 }, (_, index) => calendarStartHour + index)
  const weekStart = startOfCurrentWeek(weekOffset)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    return { date, posts: posts.filter((post) => post.publish_at && dateKey(new Date(post.publish_at), timezone) === dateKey(date, timezone)) }
  })

  return (
    <div>
      <div className="flex flex-col justify-between gap-3 border-b border-paper-line px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-paper-ink">{new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }).format(weekStart)}</p>
          <p className="mt-0.5 text-[12px] text-paper-ink/50">Weekly publishing schedule · {timezone.replaceAll('_', ' ')}</p>
        </div>
        <div className="flex items-center gap-1.5" aria-label="Calendar week navigation">
          <button aria-label="Previous week" className="grid size-9 place-items-center rounded-md text-paper-ink/60 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => setWeekOffset((current) => current - 1)} type="button"><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <button className="h-9 rounded-md border border-paper-line px-3 text-[12px] font-medium text-paper-ink/75 transition-colors hover:bg-paper-soft hover:text-paper-ink disabled:opacity-45" disabled={weekOffset === 0} onClick={() => setWeekOffset(0)} type="button">Today</button>
          <button aria-label="Next week" className="grid size-9 place-items-center rounded-md text-paper-ink/60 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => setWeekOffset((current) => current + 1)} type="button"><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className="grid grid-cols-[54px_repeat(7,minmax(0,1fr))] border-b border-paper-line bg-paper-raised">
            <div className="border-r border-paper-line" />
            {days.map((day) => {
              const isToday = dateKey(day.date, timezone) === dateKey(new Date(), timezone)
              return <div className="border-r border-paper-line px-3 py-3 last:border-r-0" key={`header-${day.date.toISOString()}`}>
                <p className={cn('text-[11px] font-medium', isToday ? 'text-brand' : 'text-paper-ink/50')}>{new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: timezone }).format(day.date)}</p>
                <p className={cn('mt-1 text-[17px] font-semibold tracking-[-0.03em]', isToday ? 'text-brand' : 'text-paper-ink')}>{new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: timezone }).format(day.date)}</p>
              </div>
            })}
          </div>
          <div className="grid grid-cols-[54px_repeat(7,minmax(0,1fr))]">
            <div className="relative h-[624px] border-r border-paper-line bg-paper">
              {calendarHours.map((hour) => <span className="absolute right-2 -translate-y-1/2 text-[10px] text-paper-ink/35" key={hour} style={{ top: `${((hour - calendarStartHour) / (calendarEndHour - calendarStartHour)) * 100}%` }}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: timezone }).format(new Date(2020, 0, 1, hour))}</span>)}
            </div>
            {days.map((day) => {
              const isToday = dateKey(day.date, timezone) === dateKey(new Date(), timezone)
              return <div className={cn('relative h-[624px] border-r border-paper-line last:border-r-0', isToday && 'bg-brand/[0.035]')} key={day.date.toISOString()}>
                {calendarHours.map((hour) => <div className="absolute inset-x-0 border-t border-paper-line/70" key={hour} style={{ top: `${((hour - calendarStartHour) / (calendarEndHour - calendarStartHour)) * 100}%` }} />)}
                {day.posts.map((post) => {
                  const time = timeOfDayInTimezone(new Date(post.publish_at!), timezone)
                  const minutes = time.hour * 60 + time.minute
                  const top = Math.max(8, Math.min(94, ((minutes - calendarStartHour * 60) / ((calendarEndHour - calendarStartHour) * 60)) * 100))
                  const confirmed = post.status === 'scheduled'
                  return <div className={cn('absolute inset-x-2 overflow-hidden rounded-lg border border-paper-line border-l-[3px] bg-paper-raised p-2 shadow-[0_6px_16px_rgba(0,0,0,0.14)] transition-transform duration-150 hover:z-10 hover:-translate-y-0.5', confirmed ? 'border-l-status-paper-ready' : 'border-l-brand')} key={post.id} style={{ top: `${top}%` }}>
                    <p className="text-[10px] font-medium text-paper-ink/55">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(post.publish_at!))}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-paper-ink">{post.title || 'Untitled upload'}</p>
                    <span className={cn('mt-1.5 inline-flex text-[9px] font-semibold', confirmed ? 'text-status-paper-ready' : 'text-brand')}>{confirmed ? 'YouTube scheduled' : 'Awaiting YouTube'}</span>
                  </div>
                })}
                {day.posts.length === 0 ? <button aria-label={`Create a release for ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: timezone }).format(day.date)}`} className="absolute left-2 top-3 inline-flex size-7 items-center justify-center rounded-md text-paper-ink/30 transition-colors hover:bg-paper-soft hover:text-brand" onClick={onNewUpload} type="button"><Plus className="size-4" /></button> : null}
              </div>
            })}
          </div>
        </div>
      </div>
      {posts.length === 0 ? <div className="border-t border-paper-line px-5 py-4 text-[13px] text-paper-ink/55 sm:px-6">Nothing planned for this week yet. <button className="font-semibold text-brand transition-colors hover:text-brand-hover" onClick={onNewUpload} type="button">Create your first post</button></div> : null}
    </div>
  )
}

export interface DashboardPageProps {
  accountLabel: string
  accountEmail: string
  onSignOut: () => void | Promise<void>
  userId?: string
  initialNotice?: { message: string; tone: 'success' | 'error' } | null
}

export function DashboardPage({ accountLabel, accountEmail, onSignOut, userId = '', initialNotice = null }: DashboardPageProps) {
  const queryClient = useQueryClient()
  const [activeLane, setActiveLane] = useState<ReleaseLane>('drafts')
  const [view, setView] = useState<ReleaseView>('calendar')
  const [selectedChannelId, setSelectedChannelId] = useState('all')
  const [selectedTag, setSelectedTag] = useState('all')
  const [search, setSearch] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [queueingPostId, setQueueingPostId] = useState<string | null>(null)
  const [publishingActionPostId, setPublishingActionPostId] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(initialNotice)
  const [postLimit, setPostLimit] = useState(DEFAULT_POST_LIMIT)

  const postsQuery = useQuery({
    enabled: Boolean(userId),
    placeholderData: (previousData) => previousData,
    queryKey: ['video-posts', userId, postLimit],
    queryFn: () => fetchVideoPosts(postLimit),
  })
  const countsQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: ['video-post-counts', userId],
    queryFn: fetchVideoPostCounts,
  })
  const channelsQuery = useYoutubeChannels(userId)
  const posts = postsQuery.data?.posts ?? EMPTY_POSTS
  const postsTotal = postsQuery.data?.total ?? posts.length
  const channels = (channelsQuery.data ?? []).filter((channel) => channel.connection_status !== 'disconnected')
  const loadedCounts = useMemo(() => Object.fromEntries(
    (Object.keys(LANE_STATUSES) as ReleaseLane[]).map((lane) => [lane, posts.filter((post) => LANE_STATUSES[lane].includes(post.status)).length]),
  ) as Record<ReleaseLane, number>, [posts])
  const counts = countsQuery.data ?? loadedCounts
  const assetIds = useMemo(() => Array.from(new Set(posts.flatMap((post) => [post.video_asset_id, post.thumbnail_asset_id].filter((id): id is string => Boolean(id))))).sort(), [posts])
  const assetsQuery = useQuery({
    enabled: Boolean(userId) && assetIds.length > 0,
    queryKey: ['media-assets', userId, assetIds],
    queryFn: () => fetchMediaAssets(assetIds),
  })
  const assetMap = useMemo(() => new Map((assetsQuery.data ?? []).map((asset) => [asset.id, asset])), [assetsQuery.data])
  const tags = useMemo(() => Array.from(new Set(posts.flatMap((post) => post.tags))).sort((left, right) => left.localeCompare(right)), [posts])
  const timezone = posts.find((post) => post.schedule_timezone)?.schedule_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const visiblePosts = posts.filter((post) => {
    if (view === 'list' && !LANE_STATUSES[activeLane].includes(post.status)) return false
    if (selectedChannelId !== 'all' && post.channel_id !== selectedChannelId) return false
    if (selectedTag !== 'all' && !post.tags.includes(selectedTag)) return false
    const term = search.trim().toLowerCase()
    return !term || `${post.title} ${post.description} ${post.tags.join(' ')}`.toLowerCase().includes(term)
  })

  function openComposer() {
    setUploadNotice(null)
    setEditingPostId(null)
    setComposerOpen(true)
  }

  function showLane(lane: ReleaseLane) {
    setActiveLane(lane)
    setView('list')
  }

  function editPost(postId: string) {
    setUploadNotice(null)
    setEditingPostId(postId)
    setComposerOpen(true)
  }

  function closeComposer() {
    setComposerOpen(false)
    setEditingPostId(null)
  }

  function askToDeletePost(postId: string) {
    setUploadNotice(null)
    setDeleteError(null)
    setDeletingPostId(postId)
  }

  async function queuePost(postId: string) {
    if (!userId) return
    setQueueingPostId(postId)
    setUploadNotice(null)
    try {
      const { error } = await insforge.database.rpc('enqueue_video_post', { p_video_post_id: postId })
      if (error) throw error
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['video-posts', userId] }),
        queryClient.invalidateQueries({ queryKey: ['video-post-counts', userId] }),
      ])
      setUploadNotice({ message: 'Release queued. QueuePilot will upload it privately to YouTube and confirm the final state.', tone: 'success' })
    } catch (caughtError) {
      setUploadNotice({ message: toUserErrorMessage(caughtError, 'The release could not enter the YouTube queue.'), tone: 'error' })
    } finally {
      setQueueingPostId(null)
    }
  }

  async function runPublishingAction(postId: string, action: 'cancel' | 'retry') {
    if (!userId) return
    setPublishingActionPostId(postId)
    setUploadNotice(null)
    try {
      const { error } = await insforge.database.rpc(
        action === 'cancel' ? 'cancel_queued_video_post' : 'retry_video_post',
        { p_video_post_id: postId },
      )
      if (error) throw error
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['video-posts', userId] }),
        queryClient.invalidateQueries({ queryKey: ['video-post-counts', userId] }),
      ])
      setUploadNotice({
        message: action === 'cancel'
          ? 'The queued release was cancelled before transfer started.'
          : 'The failed release was returned to the YouTube queue.',
        tone: 'success',
      })
    } catch (caughtError) {
      setUploadNotice({
        message: toUserErrorMessage(caughtError, action === 'cancel' ? 'The queued release could not be cancelled.' : 'The failed release could not be retried.'),
        tone: 'error',
      })
    } finally {
      setPublishingActionPostId(null)
    }
  }

  const closeDeleteDialog = useCallback(() => {
    setDeleteError(null)
    setDeletingPostId(null)
  }, [])

  async function confirmDeleteDraft() {
    if (!deletingPostId || !userId) return
    setDeleteBusy(true)
    setDeleteError(null)

    try {
      const { data, error } = await insforge.database.rpc('delete_video_draft', {
        p_video_post_id: deletingPostId,
      })
      if (error) throw error

      const objects = readDeletedStorageObjects(data, userId)
      const cleanupResults = await Promise.all(objects.map(async ({ bucket, key }) => {
        const { error: storageError } = await insforge.storage.from(bucket).remove(key)
        return storageError
      }))
      const cleanupFailed = cleanupResults.some(Boolean)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['video-posts', userId] }),
        queryClient.invalidateQueries({ queryKey: ['video-post-counts', userId] }),
        queryClient.invalidateQueries({ queryKey: ['media-assets', userId] }),
      ])
      setDeletingPostId(null)
      setUploadNotice(cleanupFailed
        ? { message: 'Draft deleted. Some private media cleanup is pending and can be retried by the backend.', tone: 'error' }
        : { message: 'Draft and its private media were deleted.', tone: 'success' })
    } catch (caughtError) {
      setDeleteError(toUserErrorMessage(caughtError, 'The draft could not be deleted.'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const editingPost = editingPostId ? posts.find((post) => post.id === editingPostId) : undefined
  const editingSourceAsset = editingPost?.video_asset_id ? assetMap.get(editingPost.video_asset_id) : undefined
  const deletingPost = deletingPostId ? posts.find((post) => post.id === deletingPostId) : undefined
  const deletingSourceAsset = deletingPost?.video_asset_id ? assetMap.get(deletingPost.video_asset_id) : undefined
  const modalOpen = composerOpen || Boolean(deletingPost)

  return (
    <div className="min-h-screen bg-workspace text-body">
      <div aria-hidden={modalOpen ? 'true' : undefined} className="flex min-h-screen" inert={modalOpen}>
        <WorkspaceSidebar accountEmail={accountEmail} accountLabel={accountLabel} channelCount={channels.length} onNewUpload={openComposer} onSignOut={onSignOut} setView={setView} view={view} />
        <div className="min-w-0 flex-1">
        <Masthead accountEmail={accountEmail} accountLabel={accountLabel} onNewUpload={openComposer} onSignOut={onSignOut} />

        <main className="mx-auto w-full max-w-[1480px] px-4 pb-10 pt-7 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        <header className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[27px] font-semibold tracking-[-0.035em] text-ink sm:text-[31px]">Good evening, {accountLabel} <span aria-hidden="true">✦</span></h1>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-muted">Create, schedule, and publish your YouTube releases from one place.</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[9px]">{timezone.replaceAll('_', ' ')}</span>
          </div>
        </header>

        <div className="mt-5"><PublishingSummary counts={counts} onSelectLane={showLane} /></div>

        {view === 'list' ? <div className="mt-5"><StageRail activeLane={activeLane} counts={counts} setActiveLane={setActiveLane} /></div> : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
          <section className="app-panel order-2 overflow-hidden rounded-xl text-paper-ink xl:order-1" aria-labelledby={`release-lane-${activeLane}`} id="release-ledger-panel" role="tabpanel">
            <div className="border-b border-paper-line px-4 py-4 sm:px-5 lg:px-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-paper-ink">{view === 'calendar' ? 'Publishing calendar' : LANE_COPY[activeLane].label} <span className="ml-1 text-[13px] font-medium text-paper-ink/45">{visiblePosts.length}</span></h2>
                </div>
                <div className="flex h-9 rounded-[7px] border border-paper-line bg-paper-soft p-0.5" aria-label="Release view">
                  <button aria-label="List" aria-pressed={view === 'list'} className={cn('grid h-8 min-w-9 place-items-center rounded-[5px] text-paper-ink/45 transition-colors', view === 'list' && 'bg-paper-raised text-paper-ink shadow-sm')} onClick={() => setView('list')} type="button"><LayoutList className="size-4" /></button>
                  <button aria-label="Calendar" aria-pressed={view === 'calendar'} className={cn('grid h-8 min-w-9 place-items-center rounded-[5px] text-paper-ink/45 transition-colors', view === 'calendar' && 'bg-paper-raised text-paper-ink shadow-sm')} onClick={() => setView('calendar')} type="button"><CalendarDays className="size-4" /></button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
                <label className="relative min-w-0 flex-1 lg:max-w-sm">
                  <span className="sr-only">Search releases</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-paper-ink/35" />
                  <input className="paper-control h-9 w-full rounded-[7px] border border-paper-line bg-paper-raised pl-9 pr-3 text-[12px] text-paper-ink outline-none placeholder:text-paper-ink/35 focus:border-brand" onChange={(event) => setSearch(event.target.value)} placeholder="Search this ledger" type="search" value={search} />
                </label>
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                  <select aria-label="Filter by channel" className="paper-control h-9 max-w-48 shrink-0 rounded-[7px] border border-paper-line bg-paper-raised px-3 text-[12px] text-paper-ink/70 outline-none focus:border-brand" onChange={(event) => setSelectedChannelId(event.target.value)} value={selectedChannelId}>
                    <option value="all">All connected channels</option>
                    {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.title}</option>)}
                  </select>
                  <label className="relative shrink-0">
                    <span className="sr-only">Filter by tag</span>
                    <Tags className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-paper-ink/35" />
                    <select className="paper-control h-9 max-w-40 rounded-[7px] border border-paper-line bg-paper-raised pl-8 pr-3 text-[12px] text-paper-ink/70 outline-none focus:border-brand" onChange={(event) => setSelectedTag(event.target.value)} value={selectedTag}>
                      <option value="all">All tags</option>
                      {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                  </label>
                  <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-paper-line bg-paper-raised px-3 text-[11px] text-paper-ink/65"><Clock3 className="size-3" />{timezone.replaceAll('_', ' ')}</span>
                </div>
              </div>
            </div>

            {uploadNotice ? <div aria-live="polite" className={cn('mx-4 mt-4 border-l-2 bg-paper-raised px-3 py-2.5 text-[12px] sm:mx-5 lg:mx-6', uploadNotice.tone === 'success' ? 'border-status-paper-ready text-status-paper-ready' : 'border-status-paper-danger text-status-paper-danger')} role={uploadNotice.tone === 'error' ? 'alert' : 'status'}>{uploadNotice.message}</div> : null}

            {postsQuery.isLoading ? (
              <LedgerSkeleton />
            ) : postsQuery.isError ? (
              <div className="m-5 border-l-2 border-status-paper-danger bg-paper-raised px-3 py-2.5 text-[12px] text-status-paper-danger" role="alert">{toUserErrorMessage(postsQuery.error, 'We could not read your QueuePilot releases.')} <button className="font-medium underline" onClick={() => void postsQuery.refetch()} type="button">Try again</button></div>
            ) : view === 'list' ? (
              <ReleaseList assets={assetMap} channels={channels} lane={activeLane} onCancelPost={(postId) => void runPublishingAction(postId, 'cancel')} onDeletePost={askToDeletePost} onEditPost={editPost} onNewUpload={openComposer} onQueuePost={queuePost} onRetryPost={(postId) => void runPublishingAction(postId, 'retry')} posts={visiblePosts} publishingActionPostId={publishingActionPostId} queueingPostId={queueingPostId} timezone={timezone} />
            ) : (
              <ReleaseCalendar onNewUpload={openComposer} posts={visiblePosts} timezone={timezone} />
            )}

            {posts.length < postsTotal ? (
              <div className="border-t border-paper-line px-4 py-4 text-center sm:px-5">
                <button className="inline-flex h-10 items-center justify-center rounded-[7px] border border-paper-line bg-paper-raised px-4 text-[12px] font-medium text-paper-ink transition-colors hover:bg-paper-soft disabled:opacity-50" disabled={postsQuery.isFetching} onClick={() => setPostLimit((current) => current + DEFAULT_POST_LIMIT)} type="button">
                  {postsQuery.isFetching ? 'Loading more releases…' : `Load more releases · ${posts.length} of ${postsTotal}`}
                </button>
              </div>
            ) : null}
          </section>

          <aside className="order-1 xl:order-2" aria-label="Release controls">
            <ConnectYouTubeCard userId={userId} />
            <WorkspaceQuickActions onNewUpload={openComposer} onShowReleases={() => showLane('drafts')} />
          </aside>
        </div>
        </main>
        </div>
      </div>

      {composerOpen ? (
        <UploadComposer
          draft={editingPost}
          onClose={closeComposer}
          onSaved={() => setUploadNotice({ message: editingPost ? 'Draft changes saved.' : 'Video stored privately and added to the draft ledger.', tone: 'success' })}
          open
          sourceAsset={editingSourceAsset}
          userId={userId}
        />
      ) : null}
      {deletingPost ? (
        <DeleteDraftDialog
          busy={deleteBusy}
          error={deleteError}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDeleteDraft}
          post={deletingPost}
          sourceAsset={deletingSourceAsset}
        />
      ) : null}
    </div>
  )
}
