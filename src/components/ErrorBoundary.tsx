import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch() {
    // Intentionally client-only: no external reporting without consent.
  }

  private handleRetry = () => {
    this.setState({ hasError: false })
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-app px-4 py-10">
        <section
          aria-labelledby="workspace-error-title"
          className="w-full max-w-md overflow-hidden rounded-[12px] border border-border bg-surface"
          role="alert"
        >
          <div className="border-b border-border px-5 py-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.09em] text-muted-soft">
              Workspace interrupted
            </p>
            <h1
              className="mt-1.5 text-[20px] font-medium tracking-[-0.025em] text-ink"
              id="workspace-error-title"
            >
              Something stopped rendering
            </h1>
          </div>
          <p className="px-5 py-4 text-[13px] leading-6 text-muted">
            Your drafts and channel connection are preserved. Reload the workspace to continue.
          </p>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <button className="button-primary" onClick={this.handleRetry} type="button">
              Reload workspace
            </button>
          </div>
        </section>
      </div>
    )
  }
}
