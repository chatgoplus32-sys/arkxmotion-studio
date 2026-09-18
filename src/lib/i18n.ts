// Kamus string terpusat (ID) — mulai dari halaman stub agar bahasa konsisten.
// Pakai: import { t } from '@/lib/i18n'; t.emptyProjects dst.
export const id = {
  noPinned: 'Belum ada project yang di-pin',
  pinHint: 'Pin project favorit untuk akses cepat',
  noProjects: 'Belum ada project',
  createFirst: 'Buat project pertama untuk memulai',
  noAssets: 'Belum ada asset tersimpan',
  assetsHint: 'Asset yang di-generate akan muncul di sini',
  noResult: 'Tidak cocok dengan filter/pencarian',
  searchAsset: 'Cari asset...',
  newProject: 'Nama project baru...',
  demoNote: 'Mode demo: hasil contoh lokal, bukan data AI live.',
} as const

export const t = id
export type I18nKey = keyof typeof id
