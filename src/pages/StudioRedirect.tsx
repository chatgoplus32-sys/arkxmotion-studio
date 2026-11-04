import { useEffect } from 'react'

/**
 * Pengalih ke aplikasi ARKX AUTO Studio (dulu menu "Video Edit").
 *
 * Aplikasinya berupa halaman penuh buatan sendiri dan disajikan sebagai berkas
 * statis di public/studio → dist/studio (Vite menyalin public/ saat build).
 * Jadi di sini kita lakukan navigasi dokumen penuh, bukan render React.
 */
export default function StudioRedirect() {
  useEffect(() => {
    window.location.replace('/studio/')
  }, [])

  return (
    <div style={{ padding: '48px 16px', textAlign: 'center' }}>
      Membuka ARKX AUTO Studio…
    </div>
  )
}
