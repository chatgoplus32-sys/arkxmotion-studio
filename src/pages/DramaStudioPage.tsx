/**
 * ARKX Drama Studio — workspace cerita interaktif (static sub-app di
 * /drama-studio/, dimuat dalam iframe). Navigasi keluar dari workspace
 * ditangani tombol "←" di topbar aplikasi drama-studio itu sendiri
 * (menuju /dashboard), agar tetap bekerja dari dalam iframe.
 */
export default function DramaStudioPage() {
  return (
    <div className="relative h-[calc(100vh-4.5rem)] sm:h-[calc(100vh-5.25rem)] w-screen max-w-none -mx-4 sm:-mx-6 lg:-mx-8 -my-4 sm:-my-6 lg:-my-8 overflow-hidden bg-[#0d0b14]">
      <iframe
        src="/drama-studio/index.html"
        title="ARKX Drama Studio"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  )
}
