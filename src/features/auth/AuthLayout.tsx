import type { ReactNode } from 'react'
import { CalendarClock, FileVideo2, ShieldCheck } from 'lucide-react'

function Brand({ onLight = false }: { onLight?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand shadow-[0_0_0_5px_rgba(216,173,103,0.12)]" aria-hidden="true">
        <svg className="size-5" fill="none" viewBox="0 0 24 24">
          <path d="M4 6.5h8.5L19 12" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
          <path d="M4 12h10" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
          <path d="M4 17.5h8.5L19 12" stroke="#20170d" strokeLinecap="round" strokeWidth="1.7" />
          <circle cx="19" cy="12" fill="#20170d" r="2.25" />
        </svg>
      </span>
      <div>
        <p className={`text-[15px] font-semibold tracking-[-0.02em] ${onLight ? 'text-ink' : 'text-white'}`}>QueuePilot</p>
        <p className={`text-[11px] font-medium ${onLight ? 'text-muted' : 'text-white/45'}`}>YouTube publishing</p>
      </div>
    </div>
  )
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="h-screen overflow-hidden bg-[#0b0d0d] p-1 text-body sm:p-2">
      <section className="relative mx-auto grid h-full max-w-[1500px] overflow-hidden border border-border bg-workspace lg:grid-cols-[52%_48%]">
        <div className="relative hidden overflow-hidden border-r border-border bg-[#0d0f10] p-9 lg:block xl:p-12">
          <div className="absolute inset-x-[-15%] bottom-[-34%] h-[62%] rotate-[-9deg] bg-[radial-gradient(ellipse_at_center,rgba(216,173,103,0.32),transparent_61%)] opacity-90" />
          <div className="relative z-10"><Brand /></div>
          <div className="relative z-10 mt-28 max-w-md xl:mt-36">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">Built for YouTube creators</span>
            <h1 className="mt-6 text-[48px] font-semibold leading-[1.02] tracking-[-0.06em] text-ink xl:text-[58px]">Plan. Publish. <span className="text-brand">Grow.</span></h1>
            <p className="mt-5 max-w-sm text-[15px] leading-6 text-muted">Everything you need to prepare, schedule, and publish YouTube releases without losing the details.</p>
            <div className="mt-8 grid gap-4">
              {[
                [CalendarClock, 'Release planning', 'Keep target times and YouTube confirmations distinct.'],
                [FileVideo2, 'Private media first', 'Save source media and metadata before it reaches YouTube.'],
                [ShieldCheck, 'Channel connections on your terms', 'Connect one or more YouTube channels separately from app sign-in.'],
              ].map(([Icon, title, detail]) => {
                const FeatureIcon = Icon as typeof CalendarClock
                return <div className="flex gap-3.5" key={title as string}><span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-raised text-brand"><FeatureIcon className="size-4" /></span><div><p className="text-[14px] font-semibold text-ink">{title as string}</p><p className="mt-0.5 text-[12px] leading-5 text-muted">{detail as string}</p></div></div>
              })}
            </div>
          </div>
          <div className="absolute bottom-7 right-[-22px] hidden w-[340px] rotate-[-5deg] rounded-xl border border-white/10 bg-[#161919]/90 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)] 2xl:block">
            <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-[12px] font-semibold text-ink">Publishing calendar</span><span className="text-[10px] text-brand">This week</span></div>
            <div className="mt-4 grid grid-cols-7 gap-1">{['M','T','W','T','F','S','S'].map((day, index) => <div className={index === 2 ? 'h-24 rounded-md bg-brand/15 p-1.5' : 'h-24 rounded-md bg-white/[0.025] p-1.5'} key={`${day}-${index}`}><span className="text-[9px] text-muted">{day}</span>{index === 2 ? <span className="mt-6 block rounded bg-brand px-1.5 py-1 text-[8px] font-semibold text-brand-ink">Release</span> : null}</div>)}</div>
          </div>
        </div>

        <div className="relative flex min-h-0 items-center justify-center overflow-y-auto px-5 py-8 sm:px-8 lg:overflow-hidden">
          <div className="absolute left-5 top-5 lg:hidden"><Brand /></div>
          <div className="w-full max-w-[440px]">
            <div className="mb-8 hidden justify-end lg:flex"><p className="text-[12px] text-muted">YouTube publishing, simplified.</p></div>
            <div className="app-panel rounded-xl p-7 sm:p-9">
              {children}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
