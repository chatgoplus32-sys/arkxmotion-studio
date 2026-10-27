import { createContext, useContext } from 'react'

// KeepAliveRoutes menyimpan halaman generator tetap ter-mount saat user pindah
// menu. Halaman yang tersembunyi tetap menerima event global (mis. Ctrl+Enter),
// jadi handler seperti shortcut generate harus cek apakah halamannya aktif.
export const PageActiveContext = createContext(true)

export function usePageActive(): boolean {
  return useContext(PageActiveContext)
}
