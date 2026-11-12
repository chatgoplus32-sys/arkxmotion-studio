import { useEffect } from 'react'

/**
 * Pengalih ke aplikasi ARKX AUTO Motion — versi terpisah dari /studio/
 * (ARKX AUTO Studio). Aplikasinya halaman penuh buatan sendiri dan disajikan
 * sebagai berkas statis di public/auto-motion → dist/auto-motion (Vite menyalin
 * public/ saat build). Navigasi dokumen penuh, bukan render React.
 */
export default function AutoMotionRedirect() {
  useEffect(() => {
    window.location.replace('/auto-motion/')
  }, [])

  return (
    <div style={{ padding: '48px 16px', textAlign: 'center' }}>
      Membuka ARKX AUTO Motion…
    </div>
  )
}
