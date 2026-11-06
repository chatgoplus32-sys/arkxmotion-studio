import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Dropzone, ProgressBar, Badge } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { Upload, Loader2, ShieldCheck, Download, FileVideo, Eraser, Sparkles, ScanSearch, MonitorPlay } from 'lucide-react'
import { scanMetadataFFmpeg, stripMetadataFFmpeg } from '@/lib/ffmpeg-compress'

const REMOVED_CATEGORIES = [
  { label: 'C2PA', desc: 'Manifest & jejak provenance AI' },
  { label: 'EXIF', desc: 'Kamera, waktu, lokasi perangkat' },
  { label: 'XMP', desc: 'Paket metadata ekstensi Adobe' },
  { label: 'Timestamps', desc: 'creation_time & epoch tersembunyi' },
  { label: 'Prompt', desc: 'Komentar/prompt generator tersimpan' },
  { label: 'Encoder', desc: 'Versi encoder & software penulis' },
]

const formatSize = (b: number) => (b / (1024 * 1024)).toFixed(2) + ' MB'

export default function MetadataCleanerPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [file, setFile] = useState<File | null>(null)
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<string[] | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null)
  const [result, setResult] = useState<{ file: File; url: string; before: number; after: number } | null>(null)

  const pickFile = async (f: File | undefined | null) => {
    if (!f) return
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) {
      addToast('File harus video (mp4/mov/webm/mkv)', 'error')
      return
    }
    setFile(f)
    setFound(null)
    setResult(null)
    setProgress(null)

    setScanning(true)
    try {
      const metadata = await scanMetadataFFmpeg(f)
      setFound(metadata)
      addToast(
        metadata.length ? `Terdeteksi ${metadata.length} metadata` : 'Tidak ada metadata terdeteksi',
        metadata.length ? 'warning' : 'success'
      )
    } catch (e) {
      setFound([])
      addToast(`Scan gagal: ${(e as Error).message}`, 'error')
    } finally {
      setScanning(false)
    }
  }

  const clean = async () => {
    if (!file) return
    setCleaning(true)
    setProgress({ msg: 'Menyiapkan...', pct: 5 })
    setResult((r) => {
      if (r) URL.revokeObjectURL(r.url)
      return null
    })
    try {
      const out = await stripMetadataFFmpeg(file, (msg, pct) => setProgress({ msg, pct }))
      const url = URL.createObjectURL(out)
      setResult({ file: out, url, before: file.size, after: out.size })
      addToast('Metadata berhasil dibersihkan!', 'success')
    } catch (e) {
      addToast(`Gagal: ${(e as Error).message}`, 'error')
    } finally {
      setCleaning(false)
      setProgress(null)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="REA Tools"
        title="Metadata"
        highlight="Cleaner"
        desc="Hapus seluruh jejak metadata AI (C2PA, EXIF, XMP, timestamps, prompt tersembunyi, dan encoder) agar video AI Anda bebas dari deteksi algoritma TikTok, Instagram Reels, dan YouTube Shorts."
      />

      <div className="flex">
        <Badge variant="default" className="gap-1.5 px-3 py-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Deep C2PA &amp; ISO-BMFF Atom Sanitizer
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Kolom kiri: upload + aksi */}
        <div className="space-y-6">
          <Section title="Upload Video" icon={<Upload className="h-4 w-4" />} sub="Diproses 100% di browser — file tidak pernah diunggah ke server">
            <Dropzone
              accept="video/*,.mkv"
              onFile={pickFile}
              className="min-h-[152px]"
            >
              {file ? (
                <>
                  <FileVideo className="h-8 w-8 text-primary" />
                  <div className="text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{formatSize(file.size)}</div>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground opacity-50" />
                  <div className="text-sm font-medium">Klik atau drop video di sini</div>
                  <div className="text-xs text-muted-foreground">MP4, MOV, M4V, WEBM, MKV</div>
                </>
              )}
            </Dropzone>
          </Section>

          <Section title="Yang Dihapus" icon={<Eraser className="h-4 w-4" />} sub="Seluruh jejak metadata berikut dibuang saat pembersihan" delay={60}>
            <div className="grid grid-cols-2 gap-2">
              {REMOVED_CATEGORIES.map((c, i) => (
                <div
                  key={c.label}
                  className="rounded-xl border border-border p-2.5 transition-all duration-200 hover:border-primary/30 hover:bg-accent/40 animate-fade-in"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
                >
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <Eraser className="h-3 w-3 text-primary" /> {c.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{c.desc}</div>
                </div>
              ))}
            </div>
            <Button className="w-full mt-4" size="lg" disabled={!file || scanning || cleaning} onClick={clean}>
              {cleaning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Membersihkan... {progress ? `${progress.pct}%` : ''}</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Bersihkan Metadata</>
              )}
            </Button>
            {progress && (
              <ProgressBar className="mt-3" value={progress.pct} label={progress.msg} />
            )}
          </Section>
        </div>

        {/* Kolom kanan: hasil scan + hasil bersih */}
        <div className="space-y-6">
          <Section title="Metadata Ditemukan" icon={<ScanSearch className="h-4 w-4" />} sub="Hasil pemindaian sebelum dibersihkan" delay={60}>
            {scanning ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memindai metadata...
              </div>
            ) : found === null ? (
              <p className="text-xs text-muted-foreground">Belum ada file — upload video untuk mulai memindai.</p>
            ) : found.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada metadata terdeteksi di file ini.</p>
            ) : (
              <div className="space-y-1.5 max-h-[240px] overflow-y-auto rounded-xl border border-border p-3">
                {found.map((line) => (
                  <div key={line} className="text-xs font-mono text-muted-foreground break-all">• {line}</div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Hasil Bersih" icon={<MonitorPlay className="h-4 w-4" />} sub="Video siap unduh tanpa jejak metadata" delay={120}>
            {result ? (
              <div className="space-y-3">
                <video src={result.url} controls className="w-full rounded-xl border border-border" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Sebelum: {formatSize(result.before)}</span>
                  <span>Sesudah: {formatSize(result.after)}</span>
                </div>
                <Button variant="secondary" className="w-full" onClick={() => {
                  const a = document.createElement('a')
                  a.href = result.url
                  a.download = result.file.name
                  a.click()
                }}>
                  <Download className="mr-2 h-4 w-4" /> Unduh {result.file.name}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Belum ada hasil — jalankan "Bersihkan Metadata".</p>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
