import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'

export interface LogDetailActionsProps {
  logs: { time: string; msg: string }[]
  onClear?: () => void
  clearLabel?: string
}

/**
 * Tombol Copy + Hapus untuk panel Log Detail.
 * - Copy: salin semua baris log ke clipboard (format `[waktu] pesan`).
 * - Hapus: bersihkan log via onClear (kalau tidak diberikan, tombol Hapus disembunyikan).
 */
export function LogDetailActions({ logs, onClear, clearLabel = 'Hapus' }: LogDetailActionsProps) {
  const addToast = useToastStore((s) => s.addToast)

  if (logs.length === 0) return null

  const copyLogs = async () => {
    const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      addToast(`📋 ${logs.length} baris log dicopy ke clipboard`, 'success')
    } catch {
      // Fallback untuk browser yang blokir Clipboard API (http, iframe, dll)
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        addToast(`📋 ${logs.length} baris log dicopy ke clipboard`, 'success')
      } catch {
        addToast('Gagal copy log ke clipboard', 'error')
      }
    }
  }

  return (
    <div className="flex items-center justify-end gap-2 mb-2">
      <Button onClick={copyLogs} variant="outline" className="!py-1.5 !px-3 text-xs">
        <Copy className="h-3 w-3 mr-1" /> Copy
      </Button>
      {onClear && (
        <Button
          onClick={onClear}
          variant="outline"
          className="!py-1.5 !px-3 text-xs hover:!border-red-500/50 hover:!text-red-400"
        >
          <Trash2 className="h-3 w-3 mr-1" /> {clearLabel}
        </Button>
      )}
    </div>
  )
}
