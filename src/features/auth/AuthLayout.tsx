import type { ReactNode } from 'react'

function Brand({ onLight = false }: { onLight?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-[5px] bg-paper" aria-hidden="true">
        <svg className="size-5" fill="none" viewBox="0 0 24 24">
          <path d="M4 6.5h8.5L19 12" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
          <path d="M4 12h10" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
          <path d="M4 17.5h8.5L19 12" stroke="#151612" strokeLinecap="round" strokeWidth="1.7" />
          <circle cx="19" cy="12" fill="#ff795d" r="2.25" />
        </svg>
      </span>
      <div>
        <p className={`text-sm font-medium tracking-[-0.01em] ${onLight ? 'text-ink' : 'text-white'}`}>QueuePilot</p>
        <p className={`font-mono text-[9px] uppercase tracking-[0.08em] ${onLight ? 'text-muted' : 'text-white/35'}`}>Release operations</p>
      </div>
    </div>
  )
}

function ReleaseArtifact() {
  const stages = [
    { label: 'Media', value: '18:42', state: 'complete' },
    { label: 'Details', value: 'Ready', state: 'complete' },
    { label: 'YouTube', value: 'Private', state: 'current' },
    { label: 'Release', value: '18 Aug / 18:30 IST', state: 'upcoming' },
  ]

  return (
    <div className="mt-9 overflow-hidden rounded-[10px] border border-rail-border bg-rail-elevated">
      <div className="flex items-center justify-between border-b border-rail-border px-4 py-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">Example release</span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/50">
          <span className="size-1.5 rounded-full bg-status-ready" />
          Draft preserved
        </span>
      </div>
      <div className="grid grid-cols-[80px_1fr] gap-4 border-b border-rail-border p-4">
        <div className="aspect-video rounded-[5px] border border-white/10 bg-white/[0.045] p-2">
          <div className="h-1.5 w-8 bg-white/20" />
          <div className="mt-2 h-1 w-full bg-white/10" />
          <div className="mt-1 h-1 w-2/3 bg-white/10" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-white">Studio workflow walkthrough</p>
          <p className="mt-1 font-mono text-[10px] text-white/40">LONG FORM / 1080P</p>
        </div>
      </div>
      <div className="divide-y divide-rail-border">
        {stages.map((stage) => (
          <div className="grid grid-cols-[18px_72px_1fr] items-center px-4 py-2.5" key={stage.label}>
            <span
              className={`size-2 rounded-full ${
                stage.state === 'complete'
                  ? 'bg-status-ready'
                  : stage.state === 'current'
                    ? 'bg-brand'
                    : 'border border-white/20'
              }`}
            />
            <span className="text-[11px] text-white/45">{stage.label}</span>
            <span className="text-right font-mono text-[10px] text-white/70">{stage.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-surface text-body">
      <div className="grid min-h-screen lg:grid-cols-[minmax(360px,0.82fr)_minmax(560px,1.18fr)]">
        <aside className="relative hidden overflow-hidden border-r border-rail-border bg-rail px-10 py-9 lg:flex lg:flex-col xl:px-14 xl:py-11">
          <Brand />

          <div className="my-auto w-full max-w-md py-14">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-brand">Publishing operations</p>
            <h1 className="mt-4 max-w-sm text-[38px] font-medium leading-[1.08] tracking-[-0.04em] text-white">
              One clear path from file to release.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">
              Prepare metadata, watch the transfer, and hand the final release time to YouTube without losing the operational details.
            </p>
            <ReleaseArtifact />
          </div>

          <div className="flex items-center justify-between border-t border-rail-border pt-5">
            <p className="max-w-xs text-[11px] leading-5 text-white/35">App access and YouTube channel permission remain separate.</p>
            <span className="font-mono text-[9px] text-white/25">01 / ACCESS</span>
          </div>
        </aside>

        <section className="flex min-h-screen flex-col bg-surface px-5 py-6 sm:px-10 lg:px-16 lg:py-10 xl:px-24">
          <div className="flex items-center justify-between lg:justify-end">
            <div className="lg:hidden"><Brand onLight /></div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Secure application access</p>
          </div>
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[410px]">{children}</div>
          </div>
          <p className="text-center font-mono text-[9px] uppercase tracking-[0.08em] text-muted-soft">Protected by InsForge authentication</p>
        </section>
      </div>
    </main>
  )
}
