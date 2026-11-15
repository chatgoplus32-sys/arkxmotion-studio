/**
 * ARKX Drama Studio — workspace cerita interaktif (static sub-app di
 * /drama-studio/, dimuat dalam iframe full-viewport). Navigasi keluar dari
 * workspace ditangani tombol "←" di topbar aplikasi drama-studio itu sendiri
 * (menuju /dashboard), agar tetap bekerja dari dalam iframe di semua ukuran
 * layar (HP & PC).
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
