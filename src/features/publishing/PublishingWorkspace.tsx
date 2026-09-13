import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
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
  Tags,
  Trash2,
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
  pipeline: ['queued', 'uploading', 'processing'],
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
    <span className="grid size-9 shrink-0 place-items-center rounded-[7px] bg-paper" aria-hidden="true">
      <svg className="size-6" fill="none" viewBox="0 0 24 24">
        <path d="M4 6.5h8.5L19 12" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M4 12h10" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M4 17.5h8.5L19 12" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
        <circle cx="19" cy="12" fill="#ff795d" r="2.25" />
      </svg>
    </span>
  )
}

function Masthead({
  accountEmail,
  accountLabel,
  channelCount,
  onNewUpload,
  onSignOut,
}: {
  accountEmail: string
  accountLabel: string
  channelCount: number
  onNewUpload: () => void
  onSignOut: () => void | Promise<void>
}) {
  return (
    <header className="border-b border-border bg-app">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <RunwayMark />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tracking-[-0.02em] text-ink">QueuePilot</p>
            <p className="hidden text-[10px] text-muted sm:block">release operations</p>
          </div>
        </div>

        <div className="ml-3 hidden h-8 w-px bg-border sm:block" />
        <div className="hidden min-w-0 sm:block">
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-soft">Workspace</p>
          <p className="mt-0.5 text-[11px] text-text-soft">Personal · {channelCount} {channelCount === 1 ? 'channel' : 'channels'}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button aria-label="New upload" className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-brand-hover" onClick={onNewUpload} type="button">
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">New upload</span>
            <span className="sm:hidden">New</span>
          </button>
          <div className="ml-1 hidden items-center gap-2.5 border-l border-border pl-3 md:flex">
            <span className="grid size-8 place-items-center rounded-full border border-border bg-surface-raised text-[10px] font-semibold text-text-soft">{accountLabel}</span>
            <p className="max-w-44 truncate text-[11px] text-muted">{accountEmail}</p>
          </div>
          <button aria-label="Sign out" className="grid size-10 place-items-center rounded-[7px] text-muted transition-colors hover:bg-surface-raised hover:text-ink" onClick={() => void onSignOut()} type="button">
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
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
      <div className="grid min-w-[700px] grid-cols-5 border-y border-border">
        {lanes.map((lane, index) => (
          <button
            aria-controls="release-ledger-panel"
            aria-selected={activeLane === lane}
            className={cn(
              'group relative flex min-h-[72px] items-center gap-3 border-r border-border px-4 text-left last:border-r-0 transition-colors',
              activeLane === lane ? 'bg-surface-raised text-ink' : 'text-muted hover:bg-surface hover:text-text-soft',
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
            {activeLane === lane ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" /> : null}
            <span className="font-mono text-[10px] text-muted-soft">0{index + 1}</span>
            <span className="text-[13px] font-medium">{LANE_COPY[lane].label}</span>
            <span className={cn('ml-auto font-mono text-[11px]', activeLane === lane ? 'text-brand' : 'text-muted-soft')}>{counts[lane]}</span>
          </button>
        ))}
      </div>
    </div>
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
  posts,
  timezone,
}: {
  assets: Map<string, MediaAssetListRecord>
  channels: YoutubeChannel[]
  lane: ReleaseLane
  onDeletePost: (postId: string) => void
  onEditPost: (postId: string) => void
  onNewUpload: () => void
  posts: VideoPostRecord[]
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
          <article className="grid gap-4 px-4 py-4 transition-colors hover:bg-paper-raised sm:px-5 xl:grid-cols-[minmax(360px,1fr)_150px_130px] xl:items-center" key={post.id}>
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
              <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-paper-ink/45">{timing.label}</p>
              <p className="mt-1 font-medium text-paper-ink/75">{timing.day} · {timing.time}</p>
              <p className="mt-0.5 font-mono text-[8px] text-paper-ink/40">{timezone.replaceAll('_', ' ')}</p>
            </div>

            <div className="grid grid-cols-[86px_1fr] items-center gap-2 xl:block">
              <span className="text-[12px] text-paper-ink/45 xl:hidden">State</span>
              <span className={cn('inline-flex w-fit items-center gap-2 font-mono text-[9px] font-medium uppercase tracking-[0.08em]', status.className)}><span className="size-1.5 rounded-full bg-current" />{status.label}</span>
              {post.status === 'draft' ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-paper-line bg-paper-raised px-2.5 text-[11px] font-medium text-paper-ink/70 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => onEditPost(post.id)} type="button"><Pencil className="size-3" aria-hidden="true" />Edit</button>
                  <button aria-label={`Delete ${post.title || 'untitled draft'}`} className="inline-flex size-8 items-center justify-center rounded-[5px] border border-paper-line bg-paper-raised text-paper-ink/45 transition-colors hover:border-status-paper-danger/30 hover:bg-status-paper-danger/5 hover:text-status-paper-danger" onClick={() => onDeletePost(post.id)} type="button"><Trash2 className="size-3.5" aria-hidden="true" /></button>
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

function ReleaseCalendar({ posts, timezone }: { posts: VideoPostRecord[]; timezone: string }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = startOfCurrentWeek(weekOffset)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    return { date, posts: posts.filter((post) => post.publish_at && dateKey(new Date(post.publish_at), timezone) === dateKey(date, timezone)) }
  })

  return (
    <div>
      <div className="flex items-center justify-between border-b border-paper-line px-4 py-3 sm:px-5">
        <div>
          <p className="text-[13px] font-medium text-paper-ink/75">Week of {new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(weekStart)}</p>
          <p className="mt-0.5 font-mono text-[9px] text-paper-ink/45">{timezone.replaceAll('_', ' ')}</p>
        </div>
        <div className="flex items-center gap-1" aria-label="Calendar week navigation">
          <button aria-label="Previous week" className="grid size-10 place-items-center rounded-[5px] text-paper-ink/55 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => setWeekOffset((current) => current - 1)} type="button"><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <button className="h-10 rounded-[5px] px-2.5 text-[11px] font-medium text-paper-ink/60 transition-colors hover:bg-paper-soft hover:text-paper-ink" disabled={weekOffset === 0} onClick={() => setWeekOffset(0)} type="button">Today</button>
          <button aria-label="Next week" className="grid size-10 place-items-center rounded-[5px] text-paper-ink/55 transition-colors hover:bg-paper-soft hover:text-paper-ink" onClick={() => setWeekOffset((current) => current + 1)} type="button"><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="grid min-h-[400px] grid-cols-1 divide-y divide-paper-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
        {days.map((day) => (
          <div className="min-h-28 p-3 xl:min-h-[400px]" key={day.date.toISOString()}>
            <div className="flex items-center justify-between xl:block">
              <p className="font-mono text-[9px] uppercase tracking-[0.07em] text-paper-ink/45">{new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: timezone }).format(day.date)}</p>
              <p className="mt-1 text-lg font-medium text-paper-ink">{new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: timezone }).format(day.date)}</p>
            </div>
            {day.posts.length > 0 ? day.posts.map((post) => (
              <div className="mt-3 border-l-2 border-brand bg-paper-raised p-2.5" key={post.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[8px] text-paper-ink/45">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(post.publish_at!))}</span>
                  <span className={cn('font-mono text-[8px] uppercase tracking-[0.05em]', post.status === 'scheduled' ? 'text-status-paper-ready' : 'text-status-paper-warning')}>{post.status === 'scheduled' ? 'Confirmed' : 'Target'}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-[11px] font-medium leading-4 text-paper-ink/80">{post.title || 'Untitled upload'}</p>
              </div>
            )) : <p className="mt-4 font-mono text-[8px] uppercase tracking-[0.06em] text-paper-ink/30">No release</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ReleaseFacts({
  channelLabel,
  counts,
  timezone,
}: {
  channelLabel: string
  counts: Record<ReleaseLane, number>
  timezone: string
}) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-surface" aria-labelledby="release-facts-heading">
      <div className="border-b border-border px-4 py-3.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">Live workspace data</p>
        <h2 className="mt-1.5 text-[15px] font-medium text-ink" id="release-facts-heading">Release snapshot</h2>
      </div>
      <dl className="divide-y divide-border px-4">
        <div className="flex items-start justify-between gap-4 py-3"><dt className="text-[11px] text-muted">Scope</dt><dd className="max-w-44 text-right text-[11px] font-medium text-text-soft">{channelLabel}</dd></div>
        <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[11px] text-muted">Drafts</dt><dd className="font-mono text-[11px] text-text-soft">{counts.drafts}</dd></div>
        <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[11px] text-muted">In pipeline</dt><dd className="font-mono text-[11px] text-text-soft">{counts.pipeline}</dd></div>
        <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[11px] text-muted">Confirmed</dt><dd className="font-mono text-[11px] text-text-soft">{counts.scheduled}</dd></div>
        <div className="flex items-start justify-between gap-4 py-3"><dt className="text-[11px] text-muted">Timezone</dt><dd className="max-w-44 text-right font-mono text-[9px] text-text-soft">{timezone.replaceAll('_', ' ')}</dd></div>
      </dl>
      <p className="border-t border-border px-4 py-3 text-[10px] leading-5 text-muted-soft">YouTube Studio history is not imported. Scheduled means YouTube confirmed it.</p>
    </section>
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
  const [view, setView] = useState<ReleaseView>('list')
  const [selectedChannelId, setSelectedChannelId] = useState('all')
  const [selectedTag, setSelectedTag] = useState('all')
  const [search, setSearch] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId)
  const channelLabel = selectedChannel?.title ?? (channels.length === 1 ? channels[0].title : 'All connected channels')
  const timezone = posts.find((post) => post.schedule_timezone)?.schedule_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const visiblePosts = posts.filter((post) => {
    if (!LANE_STATUSES[activeLane].includes(post.status)) return false
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
    <div className="min-h-screen bg-app text-body">
      <div aria-hidden={modalOpen ? 'true' : undefined} inert={modalOpen}>
        <Masthead accountEmail={accountEmail} accountLabel={accountLabel} channelCount={channels.length} onNewUpload={openComposer} onSignOut={onSignOut} />

        <main className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-8 sm:px-6 lg:px-8 lg:pb-14 lg:pt-11">
        <header className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Publishing operations / YouTube</p>
          <h1 className="mt-4 text-[40px] font-medium leading-[1.05] tracking-[-0.04em] text-ink">Release desk</h1>
          <p className="mt-4 max-w-2xl text-[14px] leading-6 text-muted">Prepare the manifest, follow the transfer, and distinguish intended dates from YouTube-confirmed releases.</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted">
            <span><span className="font-mono text-[9px] uppercase tracking-[0.07em] text-muted-soft">Scope</span> · {channelLabel}</span>
            <span><span className="font-mono text-[9px] uppercase tracking-[0.07em] text-muted-soft">Time</span> · {timezone.replaceAll('_', ' ')}</span>
          </div>
        </header>

        <div className="mt-9"><StageRail activeLane={activeLane} counts={counts} setActiveLane={setActiveLane} /></div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
          <section className="order-2 overflow-hidden rounded-[12px] bg-paper text-paper-ink shadow-soft xl:order-1" aria-labelledby={`release-lane-${activeLane}`} id="release-ledger-panel" role="tabpanel">
            <div className="border-b border-paper-line px-4 py-4 sm:px-5 lg:px-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-paper-ink/45">{LANE_COPY[activeLane].eyebrow}</p>
                  <h2 className="mt-1.5 text-[20px] font-medium tracking-[-0.025em] text-paper-ink">{LANE_COPY[activeLane].label} ledger <span className="ml-1 font-mono text-[11px] font-normal text-paper-ink/40">{visiblePosts.length}</span></h2>
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
                  <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[7px] border border-paper-line bg-paper-raised px-3 font-mono text-[9px] text-paper-ink/55"><Clock3 className="size-3" />{timezone.replaceAll('_', ' ')}</span>
                </div>
              </div>
            </div>

            {uploadNotice ? <div aria-live="polite" className={cn('mx-4 mt-4 border-l-2 bg-paper-raised px-3 py-2.5 text-[12px] sm:mx-5 lg:mx-6', uploadNotice.tone === 'success' ? 'border-status-paper-ready text-status-paper-ready' : 'border-status-paper-danger text-status-paper-danger')} role={uploadNotice.tone === 'error' ? 'alert' : 'status'}>{uploadNotice.message}</div> : null}

            {postsQuery.isLoading ? (
              <LedgerSkeleton />
            ) : postsQuery.isError ? (
              <div className="m-5 border-l-2 border-status-paper-danger bg-paper-raised px-3 py-2.5 text-[12px] text-status-paper-danger" role="alert">{toUserErrorMessage(postsQuery.error, 'We could not read your QueuePilot releases.')} <button className="font-medium underline" onClick={() => void postsQuery.refetch()} type="button">Try again</button></div>
            ) : view === 'list' ? (
              <ReleaseList assets={assetMap} channels={channels} lane={activeLane} onDeletePost={askToDeletePost} onEditPost={editPost} onNewUpload={openComposer} posts={visiblePosts} timezone={timezone} />
            ) : (
              <ReleaseCalendar posts={visiblePosts} timezone={timezone} />
            )}

            {posts.length < postsTotal ? (
              <div className="border-t border-paper-line px-4 py-4 text-center sm:px-5">
                <button className="inline-flex h-10 items-center justify-center rounded-[7px] border border-paper-line bg-paper-raised px-4 text-[12px] font-medium text-paper-ink transition-colors hover:bg-paper-soft disabled:opacity-50" disabled={postsQuery.isFetching} onClick={() => setPostLimit((current) => current + DEFAULT_POST_LIMIT)} type="button">
                  {postsQuery.isFetching ? 'Loading more releases…' : `Load more releases · ${posts.length} of ${postsTotal}`}
                </button>
              </div>
            ) : null}
          </section>

          <aside className="order-1 grid gap-4 md:grid-cols-2 xl:order-2 xl:grid-cols-1" aria-label="Release controls">
            <ConnectYouTubeCard userId={userId} />
            <ReleaseFacts channelLabel={channelLabel} counts={counts} timezone={timezone} />
          </aside>
        </div>
        </main>
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
