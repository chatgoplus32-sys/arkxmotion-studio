import { Component, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; msg: string }

function isChunkError(msg: string): boolean {
  return /Failed to fetch.*imported module|ChunkLoadError|Loading chunk|dynamically imported module/i.test(msg)
}

function cacheBustReload() {
  // Append timestamp to bust browser cache
  const url = new URL(location.href)
  url.searchParams.set('_cb', Date.now().toString())
  location.replace(url.toString())
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, msg: '' }
  static getDerivedStateFromError(e: Error): State {
    const msg = e.message || ''
    if (isChunkError(msg)) {
      const k = 'arkx.chunk-reload'
      const count = parseInt(sessionStorage.getItem(k) || '0', 10)
      if (count < 2) {
        sessionStorage.setItem(k, String(count + 1))
        // First try: simple reload. Second try: cache-bust
        if (count === 0) {
          setTimeout(() => location.reload(), 300)
        } else {
          setTimeout(() => cacheBustReload(), 300)
        }
      }
      // If count >= 2, user sees the error page — no infinite loop
    }
    return { hasError: true, msg }
  }
  componentDidCatch(e: Error, info: any) {
    console.error('[ErrorBoundary]', e, info)
  }
  componentDidMount() { sessionStorage.removeItem('arkx.chunk-reload') }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center bg-[#0a0a0a] text-white p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-red-500/15 grid place-items-center mx-auto text-red-400">⚠</div>
            <h2 className="mt-3 text-lg font-bold">Terjadi kesalahan</h2>
            <p className="mt-2 text-sm text-white/50 break-all">{this.state.msg || 'Unknown error'}</p>
            {isChunkError(this.state.msg) && (
              <p className="mt-2 text-xs text-yellow-400/70">
                Halaman perlu dimuat ulang karena pembaruan versi terbaru.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <button onClick={() => cacheBustReload()} className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold hover:bg-white/90 transition">
                🔄 Reload (clear cache)
              </button>
              <button onClick={() => { this.setState({ hasError: false, msg: '' }); location.href='/' }} className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition">
                Ke Landing
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
