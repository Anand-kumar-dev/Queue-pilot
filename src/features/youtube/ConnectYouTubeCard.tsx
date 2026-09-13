import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { insforge } from '../../lib/insforge'
import { toUserErrorMessage } from '../../lib/errors'
import { useYoutubeChannels, youtubeChannelsQueryKey } from './channels'

interface StartConnectionResponse {
  authorizationUrl: string
}

export function ConnectYouTubeCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const channelsQuery = useYoutubeChannels(userId)
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  const [confirmingChannelId, setConfirmingChannelId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const activeChannel = channelsQuery.data?.find((channel) => channel.connection_status !== 'disconnected')
  const needsReconnect = activeChannel && activeChannel.connection_status !== 'active'

  async function connectChannel() {
    setPendingChannelId('connect')
    setActionError(null)

    try {
      const { data, error } = await insforge.functions.invoke<StartConnectionResponse>('youtube-oauth', {
        body: { action: 'start', returnTo: '/app' },
      })
      if (error) throw error
      if (!data?.authorizationUrl) throw new Error('The authorization URL was not returned.')
      window.location.assign(data.authorizationUrl)
    } catch (caughtError) {
      setActionError(toUserErrorMessage(caughtError, 'YouTube authorization is not configured yet.'))
      setPendingChannelId(null)
    }
  }

  async function disconnectChannel(channelId: string) {
    setPendingChannelId(channelId)
    setActionError(null)

    try {
      const { error } = await insforge.functions.invoke('youtube-oauth', {
        body: { action: 'disconnect', channelId },
      })
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: youtubeChannelsQueryKey(userId) })
      setConfirmingChannelId(null)
    } catch (caughtError) {
      setActionError(toUserErrorMessage(caughtError, 'The channel could not be disconnected.'))
    } finally {
      setPendingChannelId(null)
    }
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-surface" aria-labelledby="connect-heading">
      <div className="border-b border-border px-4 py-3.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">YouTube connection</p>
        <p className="mt-1.5 text-[15px] font-medium text-ink">Destination channel</p>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        {activeChannel?.thumbnail_url ? (
          <img alt="" className="size-9 rounded-[5px] border border-border object-cover" src={activeChannel.thumbnail_url} />
        ) : (
          <div className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-border bg-rail font-mono text-[9px] text-text-soft">YT</div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="connect-heading" className="truncate text-[13px] font-semibold text-ink">
              {activeChannel ? activeChannel.title : 'No YouTube channel connected'}
            </h2>
            {activeChannel ? (
              <span className={needsReconnect ? 'status-label bg-status-warning-bg text-status-warning' : 'status-label bg-status-ready-bg text-status-ready'}>
                <span className="size-1.5 rounded-full bg-current" />
                {activeChannel.connection_status.replace('_', ' ')}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] leading-5 text-muted">
            {activeChannel
              ? needsReconnect
                ? 'A fresh authorization is required before another upload.'
                : `${activeChannel.handle ?? activeChannel.youtube_channel_id} / Channel permission is separate from app login.`
              : 'Connect once to identify the destination channel and authorize uploads.'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {channelsQuery.isLoading ? (
            <div className="flex h-9 items-center gap-2 px-2 text-[12px] text-muted" role="status"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Checking connection</div>
          ) : activeChannel ? (
            <>
              {needsReconnect ? <button className="button-primary" disabled={pendingChannelId !== null} onClick={() => void connectChannel()} type="button">{pendingChannelId === 'connect' ? 'Opening YouTube...' : 'Reconnect'}</button> : null}
              <button className="button-ghost" disabled={pendingChannelId !== null} onClick={() => setConfirmingChannelId(activeChannel.id)} type="button">Disconnect</button>
            </>
          ) : (
            <button className="button-secondary" disabled={pendingChannelId === 'connect' || channelsQuery.isError} onClick={() => void connectChannel()} type="button">
              {pendingChannelId === 'connect' ? 'Opening YouTube...' : 'Connect YouTube'}
            </button>
          )}
        </div>

        {activeChannel && confirmingChannelId === activeChannel.id ? (
          <div className="rounded-[8px] border border-status-danger/20 bg-status-danger-bg/35 p-3" role="group" aria-label={`Disconnect ${activeChannel.title}?`}>
            <p className="text-[11px] leading-5 text-text-soft">This revokes QueuePilot's YouTube access. Existing release records stay in the ledger, but new transfers stop until you reconnect.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-ghost" disabled={pendingChannelId !== null} onClick={() => setConfirmingChannelId(null)} type="button">Keep connected</button>
              <button className="button-secondary" disabled={pendingChannelId !== null} onClick={() => void disconnectChannel(activeChannel.id)} type="button">
                {pendingChannelId === activeChannel.id ? <><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Disconnecting...</> : 'Disconnect channel'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {channelsQuery.isError ? <p className="notice-danger border-t border-border" role="alert">We could not read your channel connections. <button className="font-medium underline" onClick={() => void channelsQuery.refetch()} type="button">Try again</button></p> : null}
      {actionError ? <p className="notice-danger border-t border-border" role="alert">{actionError}</p> : null}
    </section>
  )
}
