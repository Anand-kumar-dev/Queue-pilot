import { useQuery } from '@tanstack/react-query'
import { insforge } from '../../lib/insforge'

export interface YoutubeChannel {
  id: string
  youtube_channel_id: string
  title: string
  handle: string | null
  thumbnail_url: string | null
  connection_status: 'active' | 'refresh_required' | 'revoked' | 'disconnected'
  connected_at: string
  last_synced_at: string | null
}

export function youtubeChannelsQueryKey(userId: string) {
  return ['youtube-channels', userId] as const
}

const CHANNEL_FIELDS = 'id,youtube_channel_id,title,handle,thumbnail_url,connection_status,connected_at,last_synced_at'

export async function fetchYoutubeChannels() {
  const { data, error } = await insforge.database
    .from('youtube_channels')
    .select(CHANNEL_FIELDS)
    .order('connected_at', { ascending: false })
    .limit(10)

  if (error) throw error
  return (data ?? []) as YoutubeChannel[]
}

export function useYoutubeChannels(userId: string) {
  return useQuery({
    enabled: Boolean(userId),
    queryKey: youtubeChannelsQueryKey(userId),
    queryFn: fetchYoutubeChannels,
  })
}
