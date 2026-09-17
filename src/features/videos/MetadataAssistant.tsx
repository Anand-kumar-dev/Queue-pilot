import { useState } from 'react'
import { Check, LoaderCircle, Sparkles } from 'lucide-react'
import { invokeAppFunction } from '../../lib/functions'
import { toUserErrorMessage } from '../../lib/errors'

export interface MetadataSuggestion {
  topic: string
  angle: string
  titleOptions: string[]
  description: string
  tags: string[]
  categoryId: string
  thumbnailText: string
}

interface MetadataAssistantProps {
  currentTitle: string
  currentDescription: string
  currentTags: string
  disabled?: boolean
  onApply: (patch: Partial<{ title: string; description: string; tags: string; categoryId: string }>) => void
}

const ACTIONS = [
  ['generate', 'Generate a complete set'],
  ['rewrite', 'Rewrite the current metadata'],
  ['shorten', 'Make it tighter'],
  ['expand', 'Add useful detail'],
] as const

export function MetadataAssistant({ currentDescription, currentTags, currentTitle, disabled, onApply }: MetadataAssistantProps) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState('clear and confident')
  const [action, setAction] = useState<(typeof ACTIONS)[number][0]>('generate')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<MetadataSuggestion | null>(null)

  async function generate() {
    setPending(true)
    setError(null)

    try {
      const { data, error: assistantError } = await invokeAppFunction<{ suggestion: MetadataSuggestion }>(
        'youtube-metadata-assistant',
        {
          action,
          audience,
          brief,
          currentDescription,
          currentTags,
          currentTitle,
          tone,
        },
      )
      if (assistantError) throw assistantError
      if (!data?.suggestion) throw new Error('The assistant did not return a suggestion.')
      setSuggestion(data.suggestion)
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, 'AI suggestions are temporarily unavailable. Your current metadata is unchanged.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-brand/35 bg-[linear-gradient(135deg,rgba(216,173,103,0.16),rgba(252,248,239,0.96)_42%)]" aria-labelledby="metadata-assistant-title">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-ink"><Sparkles className="size-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-paper-ink" id="metadata-assistant-title">Queue Pilot AI</span>
          <span className="mt-0.5 block text-[11px] leading-5 text-paper-ink/55">Suggest titles, description, topic, tags, category, and thumbnail copy.</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-brand">{open ? 'Close' : 'Open'}</span>
      </button>

      {open ? (
        <div className="border-t border-brand/20 px-4 py-4">
          <label className="manifest-label" htmlFor="ai-topic-brief">What is this video about?</label>
          <textarea
            className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-paper-line bg-paper-raised px-3 py-2.5 text-[13px] leading-5 text-paper-ink outline-none placeholder:text-paper-ink/35 focus:border-brand focus:ring-2 focus:ring-brand/15"
            disabled={disabled || pending}
            id="ai-topic-brief"
            maxLength={1_200}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Describe the topic, key promise, examples, or viewer takeaway. Existing metadata is included automatically."
            value={brief}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="manifest-label" htmlFor="ai-action">Task</label>
              <select className="manifest-input" disabled={disabled || pending} id="ai-action" onChange={(event) => setAction(event.target.value as typeof action)} value={action}>
                {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="manifest-label" htmlFor="ai-tone">Tone</label>
              <select className="manifest-input" disabled={disabled || pending} id="ai-tone" onChange={(event) => setTone(event.target.value)} value={tone}>
                <option value="clear and confident">Clear and confident</option>
                <option value="concise and technical">Concise and technical</option>
                <option value="friendly and conversational">Friendly and conversational</option>
                <option value="energetic but credible">Energetic but credible</option>
              </select>
            </div>
            <div>
              <label className="manifest-label" htmlFor="ai-audience">Audience</label>
              <input className="manifest-input" disabled={disabled || pending} id="ai-audience" maxLength={160} onChange={(event) => setAudience(event.target.value)} placeholder="e.g. beginner developers" value={audience} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="button-primary" disabled={disabled || pending || (!brief.trim() && !currentTitle.trim() && !currentDescription.trim())} onClick={() => void generate()} type="button">
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
              {pending ? 'Generating...' : 'Generate suggestions'}
            </button>
            <p className="text-[11px] leading-5 text-paper-ink/45">Nothing is applied until you choose it.</p>
          </div>
          {error ? <p className="notice-danger mt-4" role="alert">{error}</p> : null}

          {suggestion ? (
            <div className="mt-5 space-y-4 border-t border-paper-line pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="technical-label">Suggested direction</p><p className="mt-1 text-[14px] font-semibold text-paper-ink">{suggestion.topic}</p><p className="mt-1 text-[12px] leading-5 text-paper-ink/60">{suggestion.angle}</p></div>
                <button className="button-secondary" onClick={() => onApply({ categoryId: suggestion.categoryId, description: suggestion.description, tags: suggestion.tags.join(', '), title: suggestion.titleOptions[0] })} type="button"><Check className="size-4" aria-hidden="true" />Apply complete set</button>
              </div>
              <div>
                <p className="manifest-label">Title options</p>
                <div className="mt-2 grid gap-2">
                  {suggestion.titleOptions.map((option) => (
                    <button className="flex items-center justify-between gap-3 rounded-lg border border-paper-line bg-paper-raised px-3 py-2.5 text-left text-[13px] text-paper-ink transition-colors hover:border-brand" key={option} onClick={() => onApply({ title: option })} type="button"><span>{option}</span><span className="shrink-0 font-mono text-[9px] uppercase text-brand">Use title</span></button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="rounded-lg border border-paper-line bg-paper-raised p-3 text-left hover:border-brand" onClick={() => onApply({ description: suggestion.description })} type="button"><span className="manifest-label">Description</span><span className="mt-1 block line-clamp-4 text-[11px] leading-5 text-paper-ink/55">{suggestion.description}</span><span className="mt-2 block font-mono text-[9px] uppercase text-brand">Apply description</span></button>
                <div className="rounded-lg border border-paper-line bg-paper-raised p-3"><p className="manifest-label">Thumbnail copy</p><p className="mt-2 text-[17px] font-semibold tracking-[-0.02em] text-paper-ink">{suggestion.thumbnailText}</p><p className="mt-3 text-[11px] text-paper-ink/50">Copy only—thumbnail image generation is not enabled.</p></div>
              </div>
              <button className="w-full rounded-lg border border-paper-line bg-paper-raised p-3 text-left hover:border-brand" onClick={() => onApply({ categoryId: suggestion.categoryId, tags: suggestion.tags.join(', ') })} type="button"><span className="manifest-label">Tags and category</span><span className="mt-1 block text-[11px] leading-5 text-paper-ink/55">{suggestion.tags.join(' · ')}</span><span className="mt-2 block font-mono text-[9px] uppercase text-brand">Apply discovery metadata</span></button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
