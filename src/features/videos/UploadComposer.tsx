import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  FileImage,
  FileVideo2,
  LoaderCircle,
  UploadCloud,
  X,
} from 'lucide-react'
import { insforge } from '../../lib/insforge'
import { toUserErrorMessage } from '../../lib/errors'
import { useYoutubeChannels } from '../youtube/channels'
import {
  ACTIVE_UPLOAD_LIMIT_BYTES,
  ACTIVE_UPLOAD_LIMIT_MB,
  createAssetObjectKey,
  isYoutubeThumbnailMimeType,
  normalizeYoutubeTags,
  STORAGE_BUCKETS,
  type TargetPrivacyStatus,
  unicodeCharacterLength,
  utf8ByteLength,
  validateYoutubeMetadata,
  youtubeTagsCharacterLength,
  YOUTUBE_DESCRIPTION_MAX_BYTES,
  YOUTUBE_TAGS_MAX_CHARACTERS,
  YOUTUBE_THUMBNAIL_MIME_TYPES,
  YOUTUBE_TITLE_MAX_CHARACTERS,
  type MediaAssetRecord,
  type VideoPostRecord,
} from './domain'

const THUMBNAIL_LIMIT_BYTES = 2 * 1024 * 1024

type AudienceChoice = 'not-kids' | 'kids' | ''
type SubmitPhase = 'idle' | 'video' | 'thumbnail' | 'draft'

interface UploadComposerProps {
  open: boolean
  userId: string
  onClose: () => void
  onSaved?: () => void | Promise<void>
  draft?: VideoPostRecord
  sourceAsset?: Pick<MediaAssetRecord, 'original_filename' | 'size_bytes'>
}

function humanFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function titleFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function phaseLabel(phase: SubmitPhase, editing: boolean) {
  if (phase === 'video') return 'Uploading video to private storage...'
  if (phase === 'thumbnail') return 'Uploading thumbnail...'
  if (phase === 'draft') return editing ? 'Saving draft changes...' : 'Creating publishing draft...'
  return editing ? 'Save draft changes' : 'Save upload draft'
}

export function UploadComposer({ open, userId, onClose, onSaved, draft, sourceAsset }: UploadComposerProps) {
  const queryClient = useQueryClient()
  const channelsQuery = useYoutubeChannels(userId)
  const titleId = useId()
  const descriptionId = useId()
  const videoInputId = useId()
  const thumbnailInputId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const dialogTitleRef = useRef<HTMLHeadingElement>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [title, setTitle] = useState(draft?.title ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [tags, setTags] = useState(draft?.tags.join(', ') ?? '')
  const [audience, setAudience] = useState<AudienceChoice>(draft?.made_for_kids === true ? 'kids' : draft?.made_for_kids === false ? 'not-kids' : '')
  const [privacy, setPrivacy] = useState<TargetPrivacyStatus>(draft?.target_privacy_status ?? 'private')
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(draft?.publish_at))
  const [publishAt, setPublishAt] = useState(() => draft?.publish_at ? localDateTimeValue(new Date(draft.publish_at)) : localDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)))
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(draft?.contains_synthetic_media ?? false)
  const [notifySubscribers, setNotifySubscribers] = useState(draft?.notify_subscribers ?? true)
  const [selectedChannelId, setSelectedChannelId] = useState(draft?.channel_id ?? '')
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const activeChannels = useMemo(() => channelsQuery.data?.filter((channel) => channel.connection_status === 'active') ?? [], [channelsQuery.data])
  const activeChannel = activeChannels.find((channel) => channel.id === selectedChannelId) ?? activeChannels[0]
  const busy = phase !== 'idle'
  const editing = Boolean(draft)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const scheduledDate = publishAt ? new Date(publishAt) : null
  const validScheduledDate = scheduledDate && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate : null
  const normalizedTags = normalizeYoutubeTags(tags)
  const descriptionBytes = utf8ByteLength(description)
  const tagCharacters = youtubeTagsCharacterLength(normalizedTags)
  const metadataValidationError = validateYoutubeMetadata({ title, description, tags: normalizedTags })
  const manifestChecks = [
    { label: 'Destination', detail: activeChannel?.title ?? 'Channel required', complete: Boolean(activeChannel) },
    { label: 'Source media', detail: videoFile ? humanFileSize(videoFile.size) : sourceAsset ? `${sourceAsset.original_filename} / ${humanFileSize(sourceAsset.size_bytes)}` : 'Video required', complete: Boolean(videoFile || draft?.video_asset_id) },
    { label: 'Metadata', detail: metadataValidationError ?? `${unicodeCharacterLength(title.trim())}/${YOUTUBE_TITLE_MAX_CHARACTERS} title`, complete: !metadataValidationError },
    { label: 'Audience', detail: audience ? (audience === 'kids' ? 'Made for kids' : 'Not made for kids') : 'Selection required', complete: Boolean(audience) },
    { label: 'Release intent', detail: scheduleEnabled ? (validScheduledDate ? 'Target time set' : 'Date required') : `${privacy[0].toUpperCase()}${privacy.slice(1)}`, complete: !scheduleEnabled || Boolean(validScheduledDate) },
  ]
  const completedChecks = manifestChecks.filter((check) => check.complete).length

  useEffect(() => {
    if (activeChannels.length === 0) {
      setSelectedChannelId('')
      return
    }
    if (!activeChannels.some((channel) => channel.id === selectedChannelId)) {
      setSelectedChannelId(activeChannels[0].id)
    }
  }, [activeChannels, selectedChannelId])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true')
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
    window.requestAnimationFrame(() => dialogTitleRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [busy, onClose, open])

  if (!open) return null

  function selectVideo(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setError(null)

    if (!nextFile) {
      setVideoFile(null)
      return
    }
    if (nextFile.type && !nextFile.type.startsWith('video/')) {
      setError('Choose a valid video file.')
      event.target.value = ''
      return
    }
    if (nextFile.size > ACTIVE_UPLOAD_LIMIT_BYTES) {
      setError(`This InsForge deployment currently accepts files up to ${ACTIVE_UPLOAD_LIMIT_MB} MB.`)
      event.target.value = ''
      return
    }

    setVideoFile(nextFile)
    if (!title.trim()) setTitle(titleFromFile(nextFile.name))
  }

  function selectThumbnail(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setError(null)
    if (!nextFile) {
      setThumbnailFile(null)
      return
    }
    if (!isYoutubeThumbnailMimeType(nextFile.type)) {
      setError('Choose a JPEG or PNG image for the thumbnail.')
      event.target.value = ''
      return
    }
    if (nextFile.size > THUMBNAIL_LIMIT_BYTES) {
      setError('Custom thumbnails must be 2 MB or smaller.')
      event.target.value = ''
      return
    }
    setThumbnailFile(nextFile)
  }

  function validate() {
    if (!userId) return 'Your session is missing a user identifier. Sign in again and retry.'
    if (!activeChannel) return 'Connect an active YouTube channel before creating an upload.'
    if (!videoFile && !draft?.video_asset_id) return 'Choose a video file.'
    if (metadataValidationError) return metadataValidationError
    if (!audience) return 'Choose whether the video is made for kids.'
    if (scheduleEnabled) {
      const scheduledTime = new Date(publishAt)
      if (!publishAt || Number.isNaN(scheduledTime.getTime())) return 'Choose a valid release date and time.'
      if (scheduledTime.getTime() <= Date.now() + 5 * 60 * 1000) return 'Schedule the release at least five minutes from now.'
    }
    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const channel = activeChannel!
    const uploadedObjects: Array<{ bucket: string; key: string }> = []
    const postFields = {
      channel_id: channel.id,
      title: title.trim(),
      description: description.trim(),
      tags: normalizedTags,
      category_id: '22',
      default_language: null,
      target_privacy_status: scheduleEnabled ? 'public' as const : privacy,
      made_for_kids: audience === 'kids',
      contains_synthetic_media: containsSyntheticMedia,
      notify_subscribers: notifySubscribers,
      license: 'youtube',
      embeddable: true,
      public_stats_viewable: true,
      publish_at: scheduleEnabled ? new Date(publishAt).toISOString() : null,
      schedule_timezone: timezone,
    }
    setError(null)

    try {
      if (draft) {
        setPhase('draft')
        const { error: updateError } = await insforge.database
          .from('video_posts')
          .update(postFields)
          .eq('id', draft.id)
          .eq('user_id', userId)
        if (updateError) throw updateError
      } else {
        const selectedVideo = videoFile as File
        const videoAssetId = crypto.randomUUID()
        const videoKey = createAssetObjectKey({ userId, assetId: videoAssetId, fileName: selectedVideo.name })
        setPhase('video')
        const { data: videoUploadData, error: videoUploadError } = await insforge.storage
          .from(STORAGE_BUCKETS.video)
          .upload(videoKey, selectedVideo)
        if (videoUploadError || !videoUploadData?.url) throw videoUploadError ?? new Error('The video upload did not return a storage URL.')
        const storedVideoKey = videoUploadData.key ?? videoKey
        uploadedObjects.push({ bucket: STORAGE_BUCKETS.video, key: storedVideoKey })
        const videoAsset = {
          id: videoAssetId,
          bucket: STORAGE_BUCKETS.video,
          key: storedVideoKey,
          url: videoUploadData.url,
          original_filename: selectedVideo.name,
          mime_type: selectedVideo.type || 'application/octet-stream',
          size_bytes: selectedVideo.size,
        }

        let thumbnailAsset: Record<string, string | number> | null = null
        if (thumbnailFile) {
          const thumbnailAssetId = crypto.randomUUID()
          const thumbnailKey = createAssetObjectKey({ userId, assetId: thumbnailAssetId, fileName: thumbnailFile.name })
          setPhase('thumbnail')
          const { data: thumbnailUploadData, error: thumbnailUploadError } = await insforge.storage
            .from(STORAGE_BUCKETS.thumbnail)
            .upload(thumbnailKey, thumbnailFile)
          if (thumbnailUploadError || !thumbnailUploadData?.url) throw thumbnailUploadError ?? new Error('The thumbnail upload did not return a storage URL.')
          const storedThumbnailKey = thumbnailUploadData.key ?? thumbnailKey
          uploadedObjects.push({ bucket: STORAGE_BUCKETS.thumbnail, key: storedThumbnailKey })
          thumbnailAsset = {
            id: thumbnailAssetId,
            bucket: STORAGE_BUCKETS.thumbnail,
            key: storedThumbnailKey,
            url: thumbnailUploadData.url,
            original_filename: thumbnailFile.name,
            mime_type: thumbnailFile.type,
            size_bytes: thumbnailFile.size,
          }
        }

        setPhase('draft')
        const { error: draftError } = await insforge.database.rpc('create_video_draft', {
          p_channel_id: channel.id,
          p_video_asset: videoAsset,
          p_thumbnail_asset: thumbnailAsset,
          p_title: postFields.title,
          p_description: postFields.description,
          p_tags: postFields.tags,
          p_target_privacy_status: postFields.target_privacy_status,
          p_made_for_kids: postFields.made_for_kids,
          p_contains_synthetic_media: postFields.contains_synthetic_media,
          p_notify_subscribers: postFields.notify_subscribers,
          p_publish_at: postFields.publish_at,
          p_schedule_timezone: postFields.schedule_timezone,
        })
        if (draftError) throw draftError
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['video-posts', userId] }),
        queryClient.invalidateQueries({ queryKey: ['video-post-counts', userId] }),
      ])
      await onSaved?.()
      onClose()
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, draft ? 'The draft changes could not be saved.' : 'The upload draft could not be created.'))
      await Promise.allSettled(uploadedObjects.map(({ bucket, key }) => insforge.storage.from(bucket).remove(key)))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 sm:p-4 lg:p-6" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex h-full w-full max-w-[1180px] flex-col overflow-hidden bg-paper shadow-2xl sm:max-h-[920px] sm:rounded-[14px]"
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-border bg-app px-4 py-3 sm:px-6">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[7px] bg-paper">
            <span className="relative block h-4 w-5">
              <span className="absolute left-0 top-0 h-px w-3 bg-paper-ink" /><span className="absolute left-0 top-1/2 h-px w-4 bg-paper-ink" /><span className="absolute bottom-0 left-0 h-px w-3 bg-paper-ink" /><span className="absolute right-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Release manifest / {editing ? 'edit draft' : 'new draft'}</p>
            <h2 className="mt-1 truncate text-[18px] font-medium tracking-[-0.025em] text-ink outline-none" id={titleId} ref={dialogTitleRef} tabIndex={-1}>{editing ? 'Edit release draft' : 'Prepare a release'}</h2>
          </div>
          <p className="ml-auto hidden font-mono text-[9px] uppercase tracking-[0.08em] text-muted sm:block">{completedChecks} of {manifestChecks.length} ready</p>
          <span className="hidden border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-text-soft sm:block">Draft</span>
          <button aria-label="Close upload composer" className="grid size-10 shrink-0 place-items-center rounded-[7px] text-muted transition-colors hover:bg-surface-raised hover:text-ink" disabled={busy} onClick={onClose} type="button"><X className="size-4" aria-hidden="true" /></button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void handleSubmit(event)}>
          <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
            <div className="manifest-paper bg-paper px-5 py-6 text-paper-ink sm:px-8 sm:py-8 lg:overflow-y-auto lg:px-10">
              <div className="mx-auto max-w-[720px]">
            <div className="flex items-center gap-3 border-b border-border pb-5">
              {activeChannel?.thumbnail_url ? <img alt="" className="size-9 rounded-[5px] border border-border object-cover" src={activeChannel.thumbnail_url} /> : <span className="grid size-9 place-items-center rounded-[5px] bg-rail font-mono text-[9px] text-white">YT</span>}
              <div className="min-w-0 flex-1">
                <label className="text-[11px] font-medium text-muted" htmlFor={`${titleId}-channel`}>Destination channel</label>
                {activeChannels.length > 0 ? (
                  <select
                    className="mt-1 h-9 w-full max-w-sm rounded-[5px] border border-border bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-brand"
                    disabled={busy}
                    id={`${titleId}-channel`}
                    onChange={(event) => setSelectedChannelId(event.target.value)}
                    value={activeChannel?.id ?? ''}
                  >
                    {activeChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.title} · {channel.handle ?? channel.youtube_channel_id}</option>)}
                  </select>
                ) : (
                  <p className="mt-1 text-[13px] font-medium text-ink">YouTube channel required</p>
                )}
                {activeChannels.length === 0 ? <p className="mt-0.5 text-[11px] text-muted">Close this panel and connect a channel first.</p> : null}
              </div>
              {activeChannel ? <span className="status-label bg-status-ready-bg text-status-ready"><Check className="size-3" aria-hidden="true" />Connected</span> : null}
            </div>

            <section className="mt-7" aria-labelledby={`${videoInputId}-heading`}>
              <div className="flex items-end justify-between gap-4">
                <div><p className="technical-label">01 / Media</p><h3 className="mt-1 text-[15px] font-medium text-ink" id={`${videoInputId}-heading`}>Source video</h3></div>
                <span className="font-mono text-[9px] text-muted">CURRENT LIMIT {ACTIVE_UPLOAD_LIMIT_MB} MB</span>
              </div>
              {editing ? (
                <div className="mt-3 flex items-center gap-4 rounded-[8px] border border-border bg-surface px-4 py-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-surface-subtle text-ink"><FileVideo2 className="size-5" strokeWidth={1.7} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{sourceAsset?.original_filename ?? 'Stored source video'}</span><span className="mt-1 block text-[11px] text-muted">{sourceAsset ? `${humanFileSize(sourceAsset.size_bytes)} / private source preserved` : 'Private source preserved'}</span></span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-status-paper-ready">Stored</span>
                </div>
              ) : (
                <>
                  <input accept="video/*" className="sr-only" disabled={busy} id={videoInputId} onChange={selectVideo} type="file" />
                  <label className="mt-3 flex cursor-pointer items-center gap-4 rounded-[8px] border border-dashed border-border-strong bg-surface px-4 py-5 transition-colors hover:border-ink" htmlFor={videoInputId}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-surface-subtle text-ink"><UploadCloud className="size-5" strokeWidth={1.7} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{videoFile?.name ?? 'Choose a video from your device'}</span>
                      <span className="mt-1 block text-[11px] text-muted">{videoFile ? `${humanFileSize(videoFile.size)} / ready for private transfer` : 'MP4, MOV, WebM, or another video format'}</span>
                    </span>
                    <span className="button-secondary pointer-events-none">Browse</span>
                  </label>
                </>
              )}
            </section>

            <section className="mt-8 border-t border-border pt-7" aria-labelledby={`${descriptionId}-details-heading`}>
              <p className="technical-label">02 / Details</p>
              <h3 className="mt-1 text-[15px] font-medium text-ink" id={`${descriptionId}-details-heading`}>YouTube metadata</h3>
              <div className="mt-4">
                <label className="field-label" htmlFor={`${descriptionId}-title`}>Title</label>
                <input aria-invalid={unicodeCharacterLength(title.trim()) > YOUTUBE_TITLE_MAX_CHARACTERS || /[<>]/.test(title)} className="field-input" disabled={busy} id={`${descriptionId}-title`} onChange={(event) => setTitle(event.target.value)} placeholder="A clear title for this release" value={title} />
                <p className={`field-hint text-right font-mono ${unicodeCharacterLength(title.trim()) > YOUTUBE_TITLE_MAX_CHARACTERS ? '!text-status-paper-danger' : ''}`}>{unicodeCharacterLength(title.trim())} / {YOUTUBE_TITLE_MAX_CHARACTERS}</p>
              </div>
              <div className="mt-4">
                <label className="field-label" htmlFor={descriptionId}>Description</label>
                <textarea aria-invalid={descriptionBytes > YOUTUBE_DESCRIPTION_MAX_BYTES || /[<>]/.test(description)} className="mt-1.5 min-h-32 w-full resize-y rounded-[5px] border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-ink outline-none placeholder:text-muted-soft focus:border-ink focus:ring-2 focus:ring-ink/5" disabled={busy} id={descriptionId} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, chapters, credits, and links." value={description} />
                <p className={`field-hint text-right font-mono ${descriptionBytes > YOUTUBE_DESCRIPTION_MAX_BYTES ? '!text-status-paper-danger' : ''}`}>{descriptionBytes.toLocaleString()} / {YOUTUBE_DESCRIPTION_MAX_BYTES.toLocaleString()} bytes</p>
              </div>
              <div className="mt-4">
                <label className="field-label" htmlFor={`${descriptionId}-tags`}>Tags <span className="font-normal text-muted">optional</span></label>
                <input className="field-input" disabled={busy} id={`${descriptionId}-tags`} onChange={(event) => setTags(event.target.value)} placeholder="editing, creator workflow, studio" value={tags} />
                <div className="flex items-center justify-between gap-3">
                  <p className="field-hint">Separate tags with commas.</p>
                  <p className={`field-hint font-mono ${tagCharacters > YOUTUBE_TAGS_MAX_CHARACTERS ? '!text-status-paper-danger' : ''}`}>{tagCharacters} / {YOUTUBE_TAGS_MAX_CHARACTERS}</p>
                </div>
              </div>
              {!editing ? <div className="mt-4">
                <label className="field-label" htmlFor={thumbnailInputId}>Custom thumbnail <span className="font-normal text-muted">optional</span></label>
                <input accept={YOUTUBE_THUMBNAIL_MIME_TYPES.join(',')} className="sr-only" disabled={busy} id={thumbnailInputId} onChange={selectThumbnail} type="file" />
                <label className="mt-1.5 flex h-11 cursor-pointer items-center gap-2.5 rounded-[5px] border border-border bg-surface px-3 text-[13px] text-ink hover:border-border-strong" htmlFor={thumbnailInputId}>
                  <FileImage className="size-4 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{thumbnailFile?.name ?? 'Choose an image up to 2 MB'}</span>
                  {thumbnailFile ? <span className="font-mono text-[9px] text-muted">{humanFileSize(thumbnailFile.size)}</span> : null}
                </label>
              </div> : null}
            </section>

            <section className="mt-8 border-t border-border pt-7" aria-labelledby={`${descriptionId}-release-heading`}>
              <p className="technical-label">03 / Release</p>
              <h3 className="mt-1 text-[15px] font-medium text-ink" id={`${descriptionId}-release-heading`}>Audience and visibility</h3>

              <fieldset className="mt-4">
                <legend className="field-label">Is this video made for kids?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {([['not-kids', 'No, it is not made for kids'], ['kids', 'Yes, it is made for kids']] as const).map(([value, label]) => (
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] border border-border bg-surface px-3 py-3 text-[12px] text-ink has-[:checked]:border-ink" key={value}>
                      <input checked={audience === value} disabled={busy} name="audience" onChange={() => setAudience(value)} type="radio" />{label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor={`${descriptionId}-privacy`}>Visibility</label>
                  <select className="field-input" disabled={busy || scheduleEnabled} id={`${descriptionId}-privacy`} onChange={(event) => setPrivacy(event.target.value as TargetPrivacyStatus)} value={scheduleEnabled ? 'public' : privacy}>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor={`${descriptionId}-schedule`}>Release timing</label>
                  <label className="mt-1.5 flex h-11 cursor-pointer items-center gap-2.5 rounded-[5px] border border-border bg-surface px-3 text-[13px] text-ink">
                    <input checked={scheduleEnabled} disabled={busy} id={`${descriptionId}-schedule`} onChange={(event) => setScheduleEnabled(event.target.checked)} type="checkbox" />Set a YouTube target time
                  </label>
                </div>
              </div>

              {scheduleEnabled ? (
                <div className="mt-4 rounded-[7px] border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-ink"><CalendarClock className="size-4" aria-hidden="true" />Target date and time</div>
                  <input className="field-input" disabled={busy} min={localDateTimeValue(new Date(Date.now() + 5 * 60 * 1000))} onChange={(event) => setPublishAt(event.target.value)} type="datetime-local" value={publishAt} />
                  <p className="field-hint">Displayed in {timezone}. This stays a target until YouTube confirms the scheduled state.</p>
                </div>
              ) : null}

              <div className="mt-5 space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-5 text-ink"><input checked={containsSyntheticMedia} className="mt-1" disabled={busy} onChange={(event) => setContainsSyntheticMedia(event.target.checked)} type="checkbox" /><span>This video contains realistic altered or synthetic media.</span></label>
                <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-5 text-ink"><input checked={notifySubscribers} className="mt-1" disabled={busy} onChange={(event) => setNotifySubscribers(event.target.checked)} type="checkbox" /><span>Notify subscribers when YouTube publishes this video.</span></label>
                <label className="flex items-start gap-2.5 text-[12px] leading-5 text-muted"><input className="mt-1" required type="checkbox" /><span>I confirm that this upload follows YouTube's Terms of Service and Community Guidelines.</span></label>
              </div>
            </section>

            {error ? <p className="notice-danger mt-6" role="alert">{error}</p> : null}
              </div>
            </div>

            <aside className="bg-surface text-body lg:overflow-y-auto" aria-label="Manifest inspection">
              <div className="border-b border-border px-5 py-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">Manifest inspection</p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <p className="text-[15px] font-medium text-ink">Readiness</p>
                  <p className="font-mono text-[11px] text-brand">{completedChecks}/{manifestChecks.length}</p>
                </div>
                <div className="mt-3 h-0.5 bg-surface-raised">
                  <div className="h-full bg-brand transition-[width]" style={{ width: `${(completedChecks / manifestChecks.length) * 100}%` }} />
                </div>
              </div>

              <div className="border-b border-border px-5 py-5">
                <div className="aspect-video border border-border bg-app p-4">
                  <div className="flex h-full flex-col justify-between">
                    <div className="flex justify-between font-mono text-[8px] uppercase tracking-[0.08em] text-muted-soft"><span>Source record</span><span>{videoFile ? humanFileSize(videoFile.size) : sourceAsset ? humanFileSize(sourceAsset.size_bytes) : 'Awaiting file'}</span></div>
                    <div>
                      <FileVideo2 className="size-6 text-brand" strokeWidth={1.5} aria-hidden="true" />
                      <p className="mt-3 truncate text-[12px] font-medium text-text-soft">{videoFile?.name ?? sourceAsset?.original_filename ?? 'No source selected'}</p>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-soft">{editing ? 'Private source preserved' : 'Private storage first'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <dl className="divide-y divide-border border-b border-border px-5">
                {manifestChecks.map((check) => (
                  <div className="flex items-start justify-between gap-4 py-3" key={check.label}>
                    <div className="min-w-0"><dt className="text-[11px] text-muted">{check.label}</dt><dd className="mt-0.5 truncate text-[11px] text-text-soft">{check.detail}</dd></div>
                    <span className={check.complete ? 'font-mono text-[9px] uppercase tracking-[0.07em] text-status-ready' : 'font-mono text-[9px] uppercase tracking-[0.07em] text-muted-soft'}>{check.complete ? 'Ready' : 'Needed'}</span>
                  </div>
                ))}
              </dl>

              <div className="border-b border-border px-5 py-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">Transfer contract</p>
                <ol className="mt-4 space-y-3">
                  {[
                    ...(editing ? [
                      ['01', 'Preserve private source media'],
                      ['02', 'Validate YouTube metadata'],
                      ['03', 'Update owner-scoped draft'],
                    ] : [
                      ['01', `Upload to ${STORAGE_BUCKETS.video}`],
                      ['02', 'Write owner-scoped media record'],
                      ['03', 'Create draft in release ledger'],
                    ]),
                  ].map(([number, label]) => (
                    <li className="flex items-center gap-3 text-[11px] text-text-soft" key={number}><span className="font-mono text-[9px] text-brand">{number}</span><span>{label}</span></li>
                  ))}
                </ol>
                <p className="mt-4 text-[10px] leading-5 text-muted">Saving does not claim a YouTube upload or scheduled release. Those states appear only after YouTube confirms them.</p>
              </div>

              <div className="px-5 py-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">Release target</p>
                <p className="mt-2 text-[13px] font-medium text-ink">{scheduleEnabled && validScheduledDate ? validScheduledDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : scheduleEnabled ? 'Target time required' : `${privacy[0].toUpperCase()}${privacy.slice(1)} intent`}</p>
                <p className="mt-1 text-[10px] text-muted">{timezone.replaceAll('_', ' ')}</p>
              </div>
            </aside>
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-border bg-app px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="flex items-center gap-2 text-[10px] leading-5 text-muted"><FileVideo2 className="size-3.5 shrink-0" aria-hidden="true" />{editing ? 'Private source preserved → draft metadata updated' : 'Private storage → owner record → draft ledger'}</p>
            <div className="flex items-center justify-end gap-2">
              <button className="inline-flex h-10 items-center justify-center rounded-[7px] px-3.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-ink disabled:opacity-45" disabled={busy} onClick={onClose} type="button">Cancel</button>
              <button className="inline-flex h-10 min-w-44 items-center justify-center gap-2 rounded-[7px] bg-brand px-4 text-[12px] font-semibold text-brand-ink transition-colors hover:bg-brand-hover disabled:opacity-45" disabled={busy || channelsQuery.isLoading || !activeChannel} type="submit">
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : editing ? <Check className="size-4" aria-hidden="true" /> : <UploadCloud className="size-4" aria-hidden="true" />}
                {phaseLabel(phase, editing)}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  )
}
