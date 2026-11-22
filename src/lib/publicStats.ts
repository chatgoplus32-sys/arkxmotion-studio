import { useEffect, useState } from 'react'

export interface PublicStats {
  users?: number
  videos?: number
  active_users?: number
  top_pages?: { page: string; count: number }[]
}

/** Format angka besar dengan gaya yang sama di seluruh situs. */
export function formatPublicCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')}rb`
  }
  return String(value)
}

/** Ambil angka pemakaian aktual dari endpoint yang sama dengan beranda. */
export function usePublicStats(): PublicStats | null {
  const [stats, setStats] = useState<PublicStats | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/public/stats')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (alive && data?.ok) {
          setStats({
            users: data.users,
            videos: data.videos,
            active_users: data.active_users,
            top_pages: data.top_pages,
          })
        }
      })
      .catch(() => { /* statistik opsional; teks netral tetap ditampilkan */ })

    return () => { alive = false }
  }, [])

  return stats
}
