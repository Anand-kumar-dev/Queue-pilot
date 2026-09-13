import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { invokeAppFunction } from '../../lib/functions'
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
  const channels = (channelsQuery.data ?? []).filter((channel) => channel.connection_status !== 'disconnected')

  async function connectChannel() {
    setPendingChannelId('connect')
    setActionError(null)

    try {
      const { data, error } = await invokeAppFunction<StartConnectionResponse>('youtube-oauth', {
        action: 'start', returnTo: '/app',
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
      const { error } = await invokeAppFunction('youtube-oauth', { action: 'disconnect', channelId })
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
    <section className="app-panel overflow-hidden rounded-xl" aria-labelledby="connect-heading">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <p className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Connected channels</p>
        <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[11px] font-semibold text-brand">{channels.length}</span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5">
        {channelsQuery.isLoading ? <div className="flex h-12 items-center gap-2 text-[13px] text-muted" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Checking channel connections</div> : null}

        {!channelsQuery.isLoading && channels.length === 0 ? <p className="text-[13px] leading-5 text-muted">Connect a YouTube channel to choose it as the destination for a release.</p> : null}

        {channels.map((channel) => {
          const needsReconnect = channel.connection_status !== 'active'
          return (
            <div className="rounded-lg border border-border bg-surface-raised p-3" key={channel.id}>
              <div className="flex gap-3">
                {channel.thumbnail_url ? <img alt="" className="size-9 rounded-md border border-border object-cover" src={channel.thumbnail_url} /> : <div className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-rail text-[10px] font-semibold text-brand">YT</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 id={channel.id === channels[0]?.id ? 'connect-heading' : undefined} className="truncate text-[13px] font-semibold text-ink">{channel.title}</h2><span className={needsReconnect ? 'status-label bg-status-warning-bg text-status-warning' : 'status-label bg-status-ready-bg text-status-ready'}><span className="size-1.5 rounded-full bg-current" />{needsReconnect ? 'Reconnect' : 'Active'}</span></div>
                  <p className="mt-1 truncate text-[12px] text-muted">{channel.handle ?? channel.youtube_channel_id}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {needsReconnect ? <button className="button-primary h-9 px-4" disabled={pendingChannelId !== null} onClick={() => void connectChannel()} type="button">{pendingChannelId === 'connect' ? 'Opening YouTube...' : 'Reconnect'}</button> : null}
                <button className="button-ghost h-9 px-3" disabled={pendingChannelId !== null} onClick={() => setConfirmingChannelId(channel.id)} type="button">Disconnect</button>
              </div>
              {confirmingChannelId === channel.id ? <div className="mt-3 rounded-md border border-status-danger/20 bg-status-danger-bg/35 p-3" role="group" aria-label={`Disconnect ${channel.title}?`}><p className="text-[12px] leading-5 text-text-soft">This removes QueuePilot's access to this channel. Existing release records remain available.</p><div className="mt-3 flex gap-2"><button className="button-ghost h-9 px-3" disabled={pendingChannelId !== null} onClick={() => setConfirmingChannelId(null)} type="button">Keep connected</button><button className="button-secondary h-9 px-3" disabled={pendingChannelId !== null} onClick={() => void disconnectChannel(channel.id)} type="button">{pendingChannelId === channel.id ? <><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Disconnecting...</> : 'Disconnect'}</button></div></div> : null}
            </div>
          )
        })}

        <button className="button-secondary h-10 w-full" disabled={pendingChannelId === 'connect' || channelsQuery.isError} onClick={() => void connectChannel()} type="button"><Plus className="size-4" />{pendingChannelId === 'connect' ? 'Opening YouTube...' : channels.length > 0 ? 'Connect another channel' : 'Connect YouTube'}</button>
      </div>

      {channelsQuery.isError ? <p className="notice-danger border-t border-border" role="alert">We could not read your channel connections. <button className="font-medium underline" onClick={() => void channelsQuery.refetch()} type="button">Try again</button></p> : null}
      {actionError ? <p className="notice-danger border-t border-border" role="alert">{actionError}</p> : null}
    </section>
  )
}
