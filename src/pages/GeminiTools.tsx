import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { cn } from '@/lib/utils'
import { Sparkles, ExternalLink, Copy, Check, Upload, MessageSquarePlus, Scissors, Clapperboard, ArrowRight, Wand2 } from 'lucide-react'

// Tutorial Gemini dibuka di tab baru — Google memblokir iframe via X-Frame-Options: DENY
const URL_AUTO_MOTION = 'https://gemini.google.com/share/e7cf0af5e32c?social_preview=false&skid=9e553d6d-2b77-4cba-8cce-4ab5a4a3a18d&hl=id-ID'
const URL_UGC_PRO = 'https://gemini.google.com/share/37e58d869af2?skid=168a4176-4447-4c98-b04c-35333e853719'
const URL_UGC_AFFILIATE = 'https://gemini.google.com/share/55de1b1f0bdb?skid=e99bf561-01a5-4a30-b2e3-74d88ba06914'
const URL_STORYBOARD_V7 = 'https://gemini.google.com/share/b2b10282ee39?skid=b19414e9-98b3-484d-ba80-515b27ca77b4'
const URL_CLONE_POSE = 'https://gemini.google.com/share/bdcd593aad23?social_preview=false&skid=388d6197-800e-4233-851b-28bd624e17ed'

export type GeminiToolTab = 'auto-motion' | 'ugc-pro' | 'ugc-affiliate' | 'clone-pose' | 'storyboard-v7'

interface PromptTemplate { label: string; prompt: string }
interface StepDef { n: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }
interface NextTool { label: string; href: string }

interface ToolDef {
  id: GeminiToolTab
  label: string
  tagline: string
  geminiUrl: string
  steps: StepDef[]
  prompts: PromptTemplate[]
  nextTools: NextTool[]
}

const TOOLS: ToolDef[] = [
  {
    id: 'auto-motion',
    label: 'Edit Video Auto Motion',
    tagline: 'Panduan & template untuk edit video auto motion via Gemini.',
    geminiUrl: URL_AUTO_MOTION,
    steps: [
      { n: '01', icon: Upload, title: 'Siapkan video', desc: 'Simpan video sumber (mp4/referensi gerakan) — bisa dari gallery ARKXMotion atau perangkat lokal.' },
      { n: '02', icon: ExternalLink, title: 'Buka Gemini', desc: 'Klik tombol Buka Gemini untuk masuk ke percakapan tutorial auto motion.' },
      { n: '03', icon: MessageSquarePlus, title: 'Tempel prompt', desc: 'Pilih salah satu template, klik Copy, lalu paste di Gemini dan upload video sumbermu.' },
      { n: '04', icon: Scissors, title: 'Ambil hasil', desc: 'Download hasil edit dari Gemini, lalu rapikan/transcode di studio atau langsung publish.' },
    ],
    prompts: [
      {
        label: 'Auto Motion Cinematic',
        prompt: 'Edit video ini jadi versi cinematic auto motion: tambahkan gerakan kamera halus (slow push-in/pan), transisi mulus antar momen terbaik, warna hangat kontras lembut. Pertahankan durasi singkat (maks 30 detik) dan sertakan momen paling menarik di tiga detik pertama.',
      },
      {
        label: 'Auto Motion Social Hook',
        prompt: 'Edit video ini untuk konten sosial otomatis: potong bagian paling hook, tambahkan gerakan dinamis (zoom pop, pan cepat), subtitle besar di tengah, dan mulai langsung dengan aksi — tanpa intro panjang. Target vertikal 9:16.',
      },
      {
        label: 'Auto Motion Product',
        prompt: 'Edit video produk ini jadi reel otomatis: tampilkan produk dengan gerakan kamera lembut (orbit/parallax), sisipkan teks manfaat singkat per scene, akhiri dengan logo dan call-to-action. Rasio 9:16, durasi 15 detik.',
      },
    ],
    nextTools: [
      { label: 'Video Upscaler', href: '/generate/video-upscaler' },
      { label: 'Motion Control', href: '/generate/motion' },
    ],
  },
  {
    id: 'ugc-pro',
    label: 'UGC Pro',
    tagline: 'Panduan & template UGC Pro via Gemini, tetap satu alur kerja ARKXMotion Studio.',
    geminiUrl: URL_UGC_PRO,
    steps: [
      { n: '01', icon: Upload, title: 'Siapkan aset UGC', desc: 'Kumpulkan video/gambar produk, referensi gaya talking-head, dan teks manfaat utama.' },
      { n: '02', icon: ExternalLink, title: 'Buka Gemini', desc: 'Klik tombol Buka Gemini untuk masuk ke percakapan tutorial UGC Pro.' },
      { n: '03', icon: MessageSquarePlus, title: 'Pakai prompt', desc: 'Salin salah satu template di bawah, tempel di Gemini, lalu lampirkan asetmu.' },
      { n: '04', icon: Clapperboard, title: 'Finalisasi', desc: 'Rapikan hasil (hook 3 detik pertama, caption, sound) lalu publish atau olah lagi di tools studio.' },
    ],
    prompts: [
      {
        label: 'UGC Pro Talking-Head',
        prompt: 'Buatkan naskah & struktur video UGC talking-head (30 detik) untuk produk ini: hook 3 detik pertama yang menohok, 3 poin manfaat singkat, bukti sosial singkat, dan penutup dengan CTA jelas. Format vertikal 9:16, gaya bicara santai ala kreator asli.',
      },
      {
        label: 'UGC Pro Problem-Solution',
        prompt: 'Susun video UGC format problem-solution untuk produk ini: scene 1 masalah yang relatable, scene 2 unboxing/first impression, scene 3 demo pemakaian, scene 4 hasil + CTA. Tulis teks overlay tiap scene (maks 7 kata) dan arahan gerakan kamera sederhana.',
      },
      {
        label: 'UGC Pro Hook Generator',
        prompt: 'Beri saya 10 hook 3-5 kata untuk video UGC produk ini, gaya bahasa percakapan Indonesia, tanpa clickbait berlebihan, yang langsung menjawab masalah target audiensnya.',
      },
    ],
    nextTools: [
      { label: 'Motion Control', href: '/generate/motion' },
      { label: 'UGC Generator', href: '/generate/ugc' },
    ],
  },
  {
    id: 'ugc-affiliate',
    label: 'UGC Affiliate',
    tagline: 'Panduan & template UGC Affiliate via Gemini — dari produk affiliate jadi konten yang menjual.',
    geminiUrl: URL_UGC_AFFILIATE,
    steps: [
      { n: '01', icon: Upload, title: 'Siapkan aset produk', desc: 'Kumpulkan foto/video produk, harga, manfaat utama, link affiliate, dan target audiensnya.' },
      { n: '02', icon: ExternalLink, title: 'Buka Gemini', desc: 'Klik tombol Buka Gemini untuk masuk ke percakapan tutorial UGC Affiliate.' },
      { n: '03', icon: MessageSquarePlus, title: 'Pakai prompt', desc: 'Salin template, isi detail produk & audiens, lalu lampirkan asetnya di Gemini.' },
      { n: '04', icon: Wand2, title: 'Produksi konten', desc: 'Ambil naskah/shot list-nya, generate video di UGC Generator, lalu tempel link affiliate di caption atau bio.' },
    ],
    prompts: [
      {
        label: 'UGC Affiliate — Naskah 30 Detik',
        prompt: 'Buat naskah video UGC affiliate 30 detik untuk produk: [NAMA PRODUK] ([KATEGORI], harga [HARGA]). Target audiens: [TARGET]. Struktur: hook 3 detik pertama, masalah yang relatable, demo produk, 2-3 manfaat utama, dan CTA halus untuk cek link di bio/keranjang. Format vertikal 9:16, bahasa Indonesia santai ala kreator asli, tanpa klaim berlebihan atau janji hasil instan.',
      },
      {
        label: 'UGC Affiliate — Hook + Caption',
        prompt: 'Beri saya 10 hook 3-5 kata dan 3 pilihan caption untuk video UGC affiliate produk: [NAMA PRODUK] ([MANFAAT UTAMA]). Caption harus memuat CTA ke link affiliate, 3-5 hashtag relevan, dan keterangan jelas bahwa ini link affiliate. Bahasa percakapan Indonesia, jujur, tanpa clickbait berlebihan.',
      },
      {
        label: 'UGC Affiliate — Storyboard 5 Scene',
        prompt: 'Susun storyboard UGC affiliate 5 scene untuk produk: [NAMA PRODUK]. Tiap scene tulis: durasi, visual/shot (termasuk close-up produk dan demo pemakaian), teks overlay maks 7 kata, VO singkat, dan aksi kamera. Total 30 detik, format 9:16, akhiri dengan CTA ke link affiliate. Sertakan catatan disclosure affiliate di caption.',
      },
    ],
    nextTools: [
      { label: 'UGC Generator', href: '/generate/ugc' },
      { label: 'Clip Genius', href: '/tools/clip-genius' },
    ],
  },
  {
    id: 'clone-pose',
    label: 'Clone Pose',
    tagline: 'Panduan & template Clone Pose via Gemini — tiru pose foto referensi ke subjekmu.',
    geminiUrl: URL_CLONE_POSE,
    steps: [
      { n: '01', icon: Upload, title: 'Siapkan 2 foto', desc: 'Foto subjek (wajah & tubuh terlihat jelas) dan foto referensi pose dari Pinterest/feed — usahakan pose referensi tidak terpotong.' },
      { n: '02', icon: ExternalLink, title: 'Buka Gemini', desc: 'Klik tombol Buka Gemini untuk masuk ke Gem Clone Pose yang sudah disiapkan.' },
      { n: '03', icon: MessageSquarePlus, title: 'Upload & tempel prompt', desc: 'Lampirkan foto subjek lebih dulu, lalu foto pose. Sebut urutannya di prompt supaya Gemini tidak menukar peran gambar.' },
      { n: '04', icon: Wand2, title: 'Sempurnakan hasil', desc: 'Perbaiki wajah/detail yang meleset di Edit Image, atau langsung animasikan pose-nya di Image to Video.' },
    ],
    prompts: [
      {
        label: 'Clone Pose — Dasar',
        prompt: 'Gambar 1 adalah subjek (pertahankan wajah, warna kulit, bentuk tubuh, dan outfit). Gambar 2 adalah referensi pose. Tiru pose gambar 2 persis: arah tubuh, posisi tangan & kaki, kemiringan kepala, arah pandangan, dan angle kamera. Jangan ubah identitas maupun outfit subjek. Hasil fotorealistis, proporsi natural, rasio 3:4.',
      },
      {
        label: 'Clone Pose + Latar Baru',
        prompt: 'Gambar 1 adalah subjek (pertahankan wajah, rambut, dan outfit). Gambar 2 adalah referensi pose. Salin pose, gestur, dan angle kamera gambar 2 ke subjek gambar 1, lalu ganti latar menjadi: [TULIS LATAR/TEMA]. Pencahayaan dan bayangan harus menyatu dengan latar baru. Hasil fotorealistis, rasio 9:16.',
      },
      {
        label: 'Clone Pose untuk Video',
        prompt: 'Gambar 1 adalah subjek dan gambar 2 adalah referensi pose. Hasilkan satu foto vertikal 9:16 dengan pose yang sama persis seperti gambar 2: tubuh terlihat penuh, ada ruang gerak di sekeliling subjek, pencahayaan merata, tanpa crop. Hindari pose yang menutupi wajah dan pastikan tangan serta kaki terlihat jelas karena foto ini akan dianimasikan menjadi video.',
      },
    ],
    nextTools: [
      { label: 'Edit Image', href: '/generate/edit-image' },
      { label: 'Image to Video', href: '/generate/image-to-video' },
    ],
  },
  {
    id: 'storyboard-v7',
    label: 'Storyboard V7',
    tagline: 'Panduan & template Storyboard V7 via Gemini — dari ide jadi papan cerita siap produksi.',
    geminiUrl: URL_STORYBOARD_V7,
    steps: [
      { n: '01', icon: Upload, title: 'Siapkan ide', desc: 'Tulis ringkas ide/konsep, karakter, dan referensi visual yang mau dibuat storyboard-nya.' },
      { n: '02', icon: ExternalLink, title: 'Buka Gemini', desc: 'Klik tombol Buka Gemini untuk masuk ke percakapan tutorial Storyboard V7.' },
      { n: '03', icon: MessageSquarePlus, title: 'Pakai prompt', desc: 'Salin salah satu template di bawah, tempel di Gemini, lalu lengkapi detail ceritamu.' },
      { n: '04', icon: Clapperboard, title: 'Bangun visual', desc: 'Ambil daftar scene/shot-nya, lalu generate gambar/video per scene dengan tools studio.' },
    ],
    prompts: [
      {
        label: 'Storyboard V7 Lengkap',
        prompt: 'Buatkan storyboard v7 lengkap untuk ide berikut: [TULIS IDE]. Sertakan: sinopsis singkat, daftar scene (maks 8), untuk tiap scene tulis shot description, kamera angle/movement, durasi, dialog/VO, dan visual mood. Format tabel rapi, bahasa Indonesia.',
      },
      {
        label: 'Storyboard V7 Shot List',
        prompt: 'Beri saya shot list storyboard v7 dari cerita berikut: [TULIS CERITA]. Setiap shot: nomor, durasi (detik), framing (wide/medium/close-up), gerakan kamera, dan adegan yang terjadi. Total maks 12 shot, cocok untuk video vertikal 9:16.',
      },
      {
        label: 'Storyboard V7 Visual Prompt',
        prompt: 'Dari storyboard v7 berikut, tulis satu visual prompt per scene untuk generator video AI: [TEMPEL STORYBOARD]. Tiap prompt deskriptif (subjek, aksi, latar, pencahayaan, gaya sinematik), konsisten karakter antar scene, rasio 16:9.',
      },
    ],
    nextTools: [
      { label: 'UGC Generator', href: '/generate/ugc' },
      { label: 'Motion Control', href: '/generate/motion' },
    ],
  },
]

export default function GeminiToolsPage({ initialTab }: { initialTab?: GeminiToolTab }) {
  const addToast = useToastStore((s) => s.addToast)
  const [active, setActive] = useState<GeminiToolTab>(initialTab ?? 'auto-motion')
  const [copied, setCopied] = useState<string | null>(null)

  const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0]

  const copyPrompt = async (label: string, prompt: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt)
      } else {
        const ta = Object.assign(document.createElement('textarea'), { value: prompt })
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(label)
      addToast('Prompt disalin — tempel di Gemini', 'success')
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500)
    } catch {
      addToast('Gagal menyalin prompt', 'error')
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Gemini Tools"
        title="Gemini"
        highlight="Tools"
        desc="Satu halaman untuk semua panduan & prompt Gemini: Edit Video Auto Motion, UGC Pro, UGC Affiliate, Clone Pose, dan Storyboard V7."
        actions={
          <Button variant="outline" onClick={() => window.open(tool.geminiUrl, '_blank', 'noopener,noreferrer')}>
            <ExternalLink className="mr-2 h-4 w-4" /> Buka Gemini — {tool.label}
          </Button>
        }
      />

      {/* Tab */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-all border',
              active === t.id
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
            )}
          >
            {active === t.id && <Wand2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="🚀 Cara Kerja" sub="Langkah dari aset mentah jadi hasil siap pakai">
          <div className="space-y-4">
            {tool.steps.map((step) => (
              <div key={step.n} className="flex gap-3 items-start">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <step.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{step.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="space-y-6">
          <Section
            title="📝 Prompt Template"
            sub="Klik Copy lalu tempel di percakapan Gemini"
            right={
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> siap pakai
              </span>
            }
          >
            <div className="space-y-3">
              {tool.prompts.map((tpl) => (
                <div key={tpl.label} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{tpl.label}</div>
                    <Button variant="outline" size="sm" onClick={() => copyPrompt(tpl.label, tpl.prompt)}>
                      {copied === tpl.label ? <Check className="h-3.5 w-3.5 mr-1 text-green-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                      {copied === tpl.label ? 'Tersalin' : 'Copy'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{tpl.prompt}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="🎬 Lanjutkan di Studio" sub="Proses ulang aset & hasil dengan tools internal">
            <div className="flex flex-wrap gap-2">
              {tool.nextTools.map((n) => (
                <Button key={n.href} variant="secondary" onClick={() => (window.location.href = n.href)}>
                  {n.label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Halaman Gemini tidak bisa disematkan langsung di aplikasi (Google memblokir iframe via <code>X-Frame-Options: DENY</code>), jadi tutorial masing-masing tab dibuka di tab baru.
            </p>
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
