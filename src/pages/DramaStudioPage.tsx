import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * ARKX Drama Studio — workspace cerita interaktif (static sub-app di
 * /drama-studio/, dimuat dalam iframe). AI Story lewat Gemini (relay studio-ai),
 * gambar referensi lewat NexaBot GPT Image 2.5, dan video adegan lewat NexaBot
 * Omni Flash 1.2 — semuanya memakai API key NexaBot milik member (Providers).
 */
export default function DramaStudioPage() {
  return (
    <div className="relative h-[calc(100vh-4.5rem)] sm:h-[calc(100vh-5.25rem)] w-screen max-w-none -mx-4 sm:-mx-6 lg:-mx-8 -my-4 sm:-my-6 lg:-my-8 overflow-hidden bg-[#0d0b14]">
      <iframe
        src="/drama-studio/index.html"
        title="ARKX Drama Studio"
        className="absolute inset-0 h-full w-full border-0"
      />
      <Link
        to="#"
        onClick={(e) => {
          e.preventDefault()
          window.open('/drama-studio/index.html', '_blank', 'noopener,noreferrer')
        }}
        className="absolute bottom-3 right-3 z-10 inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-black/60 px-3 text-[11px] font-bold text-white/80 backdrop-blur-sm transition-colors hover:text-white"
        aria-label="Buka di tab baru"
      >
        <ExternalLink className="h-4 w-4" /> Tab baru
      </Link>
    </div>
  )
}
