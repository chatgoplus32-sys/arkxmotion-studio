/**
 * Meta per-route untuk SPA.
 *
 * index.html hanya memuat meta untuk landing (/). Halaman auth di corong
 * konversi butuh <title> dan <meta name="description"> sendiri, dan semua
 * route dalam app (butuh login) sebaiknya tidak ikut — sebelumnya Google bisa
 * mengindeks halaman dashboard yang isinya kosong tanpa sesi.
 *
 * Komponen ini dipasang sekali di dalam <Router> dan menyesuaikan head tiap
 * kali lokasi berubah.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

interface RouteMeta {
  title: string
  description: string
}

/** Route publik yang boleh diindeks. */
const PUBLIC_META: Record<string, RouteMeta> = {
  '/': {
    title: 'ARKXMotion Studio — AI Video Generation Platform',
    description:
      'Buat video AI sinematik, animasi, film, musik & konten kreatif otomatis dengan ARKXMotion Studio. Cukup upload video ngomong atau foto produk — AI menyusun caption, b-roll, transisi & CTA otomatis.',
  },
  '/login': {
    title: 'Login — ARKXMotion Studio',
    description: 'Masuk ke ARKXMotion Studio untuk mulai generate video AI dari 20 provider dalam satu dashboard.',
  },
  '/register': {
    title: 'Daftar Pro — ARKXMotion Studio',
    description: 'Gabung ARKXMotion Studio: semua fitur AI terbuka, sekali bayar permanen. Mulai generate video AI hari ini.',
  },
  '/register-status': {
    title: 'Status Pendaftaran — ARKXMotion Studio',
    description: 'Cek status pendaftaran akun ARKXMotion Studio Anda.',
  },
  '/forgot-password': {
    title: 'Lupa Password — ARKXMotion Studio',
    description: 'Atur ulang password akun ARKXMotion Studio melalui email terdaftar.',
  },
  '/reset-password': {
    title: 'Reset Password — ARKXMotion Studio',
    description: 'Buat password baru untuk akun ARKXMotion Studio Anda.',
  },
}

function setMeta(selector: string, attr: string, value: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (value === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    document.head.appendChild(el)
  }
  el.setAttribute(attr, value)
}

export default function RouteMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    // /reset-password biasanya punya token di query — cocokkan berdasarkan
    // path saja supaya tetap dapat meta yang benar.
    const base = '/' + pathname.split('/')[1]
    const meta = PUBLIC_META[base] ?? PUBLIC_META[pathname]

    if (meta) {
      document.title = meta.title
      setMeta('meta[name="description"]', 'content', meta.description)
      // Route publik: hapus robots yang mungkin tertinggal dari route dalam.
      setMeta('meta[name="robots"]', 'content', null)
    } else {
      document.title = 'ARKXMotion Studio'
      // Halaman dalam app butuh login — tidak ada isi untuk hasil pencarian.
      setMeta('meta[name="robots"]', 'content', 'noindex, nofollow')
    }

    // og:url & canonical hanya benar untuk landing; di route lain biarkan
    // (halaman auth jarang dibagikan, dan canonical ganda lebih buruk).
    if (pathname === '/') {
      setMeta('meta[property="og:title"]', 'content', meta?.title ?? '')
      setMeta('meta[name="twitter:title"]', 'content', meta?.title ?? '')
    }
  }, [pathname])

  return null
}
