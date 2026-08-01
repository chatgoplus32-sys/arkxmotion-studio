import JSZip from 'jszip'

interface DownloadItem {
  url: string
  filename: string
}

async function fetchFileAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return res.blob()
}

export async function downloadFilesAsZip(
  items: DownloadItem[],
  zipName: string = `bulk-fashion-${Date.now()}.zip`
): Promise<void> {
  const zip = new JSZip()
  const folder = zip.folder('bulk-fashion')!

  const results = await Promise.allSettled(
    items.map(async (item) => {
      const blob = await fetchFileAsBlob(item.url)
      folder.file(item.filename, blob)
      return item.filename
    })
  )

  const successCount = results.filter((r) => r.status === 'fulfilled').length
  if (successCount === 0) throw new Error('Tidak ada file yang berhasil diunduh')

  const content = await zip.generateAsync({ type: 'blob' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(content)
  link.download = zipName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

export function getExtensionFromUrl(url: string): string {
  return (url.match(/\.(png|jpe?g|webp)(\?|$)/i)?.[1] || 'jpg').toLowerCase()
}
