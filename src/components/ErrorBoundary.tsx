import { Component, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; msg: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, msg: '' }
  static getDerivedStateFromError(e: Error): State {
    const msg = e.message || ''
    if (/Failed to fetch.*imported module|ChunkLoadError|Loading chunk/i.test(msg)) {
      const k = 'arkx.chunk-reload'
      if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); location.reload() }
    }
    return { hasError: true, msg }
  }
  componentDidCatch(e: Error, info: any) {
    console.error('[ErrorBoundary]', e, info)
    const msg = e.message || ''
    if (/Failed to fetch.*imported module|ChunkLoadError|Loading chunk/i.test(msg)) {
      const k = 'arkx.chunk-reload'
      if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); setTimeout(()=>location.reload(), 500) }
    }
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
            <button onClick={() => location.reload()} className="mt-4 px-5 py-2.5 rounded-xl bg-white text-black font-semibold">Reload</button>
            <button onClick={() => { this.setState({ hasError: false, msg: '' }); location.href='/' }} className="mt-2 ml-2 px-5 py-2.5 rounded-xl border border-white/10">Ke Landing</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
