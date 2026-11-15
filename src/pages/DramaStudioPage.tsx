/**
 * ARKX Drama Studio — workspace cerita interaktif (static sub-app di
 * /drama-studio/, dimuat dalam iframe full-viewport). AI Story lewat Gemini
 * (relay studio-ai), gambar per adegan lewat NexaBot Nano Banana Pro
 * (model nano_banana_pro), dan video adegan lewat NexaBot Omni Flash 1.2
 * dengan voiceover narasi — digabung ffmpeg.wasm di Story Workspace.
 * Navigasi keluar ditangani tombol "←" di topbar aplikasi drama-studio
 * (menuju /dashboard), agar bekerja dari dalam iframe di semua layar.
 */
export default function DramaStudioPage() {
  return (
    <div className="fixed inset-0 z-[80] h-[100dvh] w-screen overflow-hidden bg-[#0d0b14]">
      <iframe
        src="/drama-studio/index.html"
        title="ARKX Drama Studio"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  )
}
