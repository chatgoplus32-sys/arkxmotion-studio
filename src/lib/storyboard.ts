/**
 * Potong 1 gambar storyboard (berisi grid panel adegan) menjadi N gambar
 * terpisah — masing-masing jadi input "1 foto" untuk Music Avatar per segmen.
 * Murni canvas, tanpa ffmpeg.
 */

export interface StoryboardLayout {
  id: string
  label: string
  cols: number
  rows: number
}

export const STORYBOARD_LAYOUTS: StoryboardLayout[] = [
  { id: '2x3', label: '2×3 (6 panel)', cols: 2, rows: 3 },
  { id: '3x2', label: '3×2 (6 panel)', cols: 3, rows: 2 },
  { id: '1x6', label: '1×6 (6 panel)', cols: 1, rows: 6 },
  { id: '6x1', label: '6×1 (6 panel)', cols: 6, rows: 1 },
  { id: '2x2', label: '2×2 (4 panel)', cols: 2, rows: 2 },
  { id: '3x3', label: '3×3 (9 panel)', cols: 3, rows: 3 },
]

export async function sliceStoryboardImage(
  file: File,
  cols: number,
  rows: number,
  onProgress?: (msg: string) => void,
): Promise<File[]> {
  const bitmap = await createImageBitmap(file)
  const cellW = Math.floor(bitmap.width / cols)
  const cellH = Math.floor(bitmap.height / rows)
  if (cellW < 32 || cellH < 32) {
    bitmap.close()
    throw new Error(`Resolusi panel terlalu kecil (${cellW}×${cellH}px) — pakai gambar storyboard beresolusi lebih tinggi`)
  }

  const out: File[] = []
  try {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        onProgress?.(`Memotong panel ${idx + 1}/${cols * rows}...`)
        const canvas = document.createElement('canvas')
        canvas.width = cellW
        canvas.height = cellH
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D tidak tersedia')
        ctx.drawImage(bitmap, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error(`Gagal memotong panel ${idx + 1}`)
        out.push(new File([blob], `panel_${idx + 1}.png`, { type: 'image/png' }))
      }
    }
  } finally {
    bitmap.close()
  }
  return out
}
