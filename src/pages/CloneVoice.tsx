import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label } from '@/components/ui'
import {
  Loader2, Mic, Square, Upload, Copy, CheckCircle2, AlertCircle, Trash2, Volume2, RefreshCw,
} from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import {
  submitNexabotVoiceClone,
  submitNexabotElevenLabs,
  fetchNexabotVoices,
  getNexabotApiKey,
  getNexabotCookies,
  type NexabotVoiceOption,
} from '@/lib/nexabot'
import {
  chargeNexabotWallet,
  refundNexabotWallet,
  fetchNexabotWallet,
  nexabotPreferServerKey,
  NEXABOT_PRICE_FALLBACK,
  type NexabotWallet,
} from '@/lib/nexabotWallet'

// ── Clone Voice + ElevenLabs (nexabot.id) ───────────────────────────────────
// Kontrak nyata halaman nexabot.id/voice-generator (dibaca dari bundle-nya):
//   POST /api/generators/voice/clone  → multipart: files, name, gender
//   POST /api/generators/voice        → JSON: { text, speakerId, languageCode: 'id-ID', speed }
//   GET  /api/generators/voices       → { voices: [{ id, name, provider }] }
// Clone membalas `{ ok, voice: { id, name, provider } }`; voice itu langsung
// dipakai sebagai `speakerId` untuk generate TTS.
const MAX_BYTES = 10 * 1024 * 1024
const MIN_SECONDS = 15
const MAX_SECONDS = 60

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

const fmtSec = (s: number) => `${s.toFixed(1)} dtk`
const formatRp = (n: number) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(n))}`
const voiceLabel = (v: NexabotVoiceOption) => `${v.name} · ${v.provider}`

function readDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    audio.onloadedmetadata = () => done(audio.duration)
    audio.onerror = () => done(0)
    audio.src = url
  })
}

/** Rekaman MediaRecorder (webm/opus) ditulis ulang sebagai WAV 16-bit PCM. */
async function toWav(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  const audio = await ctx.decodeAudioData(buf)
  const channels = audio.numberOfChannels
  const frames = audio.length
  const sampleRate = audio.sampleRate
  const blockAlign = channels * 2
  const dataSize = frames * blockAlign
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataSize, true)
  const data = Array.from({ length: channels }, (_, i) => audio.getChannelData(i))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  await ctx.close()
  return new Blob([out], { type: 'audio/wav' })
}

export default function CloneVoicePage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [name, setName] = useState('')
  const [gender, setGender] = useState<string>('female')

  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)

  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [wallet, setWallet] = useState<NexabotWallet | null>(null)
  const [cloned, setCloned] = useState<{ id: string; name: string; provider: string } | null>(null)

  const [voices, setVoices] = useState<NexabotVoiceOption[]>([])
  const [voicesError, setVoicesError] = useState<string | null>(null)
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [speakerId, setSpeakerId] = useState('')
  const [voiceQuery, setVoiceQuery] = useState('')

  const [elText, setElText] = useState('')
  const [elLoading, setElLoading] = useState(false)
  const [elUrl, setElUrl] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const chargeRef = useRef<number | null>(null)
  const coveredRef = useRef(false)

  const isAdmin = user?.role === 'admin'
  const price = wallet?.price ?? NEXABOT_PRICE_FALLBACK
  const covered = !!wallet?.unlimited?.active || coveredRef.current

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-120))
  }

  /** Kredensial NexaBot untuk satu job (pola sama dengan Edit Image). */
  const buildAuth = async (): Promise<any> => {
    const apiKey = getNexabotApiKey()
    const cookies = getNexabotCookies()
    const ticket = chargeRef.current
    let serverReady = !!wallet?.server_key?.available
    if (authToken) {
      const fresh = await fetchNexabotWallet(authToken).catch(() => null)
      if (fresh) {
        setWallet(fresh)
        serverReady = !!fresh.server_key?.available
      }
    }
    if (nexabotPreferServerKey({
      hasOwnKey: !!(apiKey || cookies),
      serverReady,
      coveredByPackage: coveredRef.current,
    })) return { master: true, ticket }
    if (apiKey || cookies) return { apiKey, cookies, ticket }
    throw new Error('NexaBot: tidak ada API key aktif dan kunci server belum tersedia — tambahkan API key di halaman Providers atau top up NexaBot dulu.')
  }

  const loadVoices = async () => {
    if (!authToken) return
    setVoicesLoading(true)
    setVoicesError(null)
    try {
      const auth = await buildAuth()
      const list = await fetchNexabotVoices(auth)
      setVoices(list)
      setSpeakerId((prev) => prev || list[0]?.id || '')
    } catch {
      // Daftar suara tidak kunci penggunaan Clone Voice.
      // Biarkan kosong agar pengguna tetap bisa klon suara tanpa memilih
      // speaker ID tertentu.
      setVoices([])
      setVoicesError(null)
    } finally {
      setVoicesLoading(false)
    }
  }

  useEffect(() => {
    if (!authToken) return
    fetchNexabotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
    void loadVoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current) }, [])

  const voiceOptions = useMemo(() => {
    const cari = voiceQuery.trim().toLowerCase()
    return cari ? voices.filter((v) => voiceLabel(v).toLowerCase().includes(cari)) : voices
  }, [voices, voiceQuery])

  const selectedVoice = voices.find((v) => v.id === speakerId)

  const applyFile = async (f: File) => {
    setError(null)
    setCloned(null)
    if (f.size > MAX_BYTES) {
      setError(`Ukuran file ${(f.size / 1024 / 1024).toFixed(1)} MB melebihi batas 10 MB.`)
      return
    }
    const okType = /\.(wav|mp3|m4a)$/i.test(f.name) || /^audio\/(wav|mpeg|mp4|x-m4a)/.test(f.type)
    if (!okType) {
      setError('Format harus WAV, M4A, atau MP3.')
      return
    }
    const secs = await readDuration(f)
    setFile(f)
    setDuration(secs)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
    if (secs && (secs < MIN_SECONDS || secs > MAX_SECONDS)) {
      setError(`Durasi ${fmtSec(secs)} — sample harus ${MIN_SECONDS}–${MAX_SECONDS} detik.`)
    }
  }

  const onPick = (files: FileList | null) => {
    const f = files?.[0]
    if (f) void applyFile(f)
  }

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
  }

  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
        setRecording(false)
        const raw = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        try {
          addLog('🎙️ Rekaman selesai — mengubah ke WAV...', 'info')
          const wav = await toWav(raw)
          const f = new File([wav], `rekaman-${Date.now()}.wav`, { type: 'audio/wav' })
          await applyFile(f)
          addLog(`✅ Rekaman siap (${(wav.size / 1024).toFixed(0)} KB)`, 'success')
        } catch (e: any) {
          setError(`Gagal memproses rekaman: ${e.message}`)
        }
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
      setRecordSeconds(0)
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          const next = s + 1
          if (next >= MAX_SECONDS) stopRecording()
          return next
        })
      }, 1000)
      addLog('🔴 Merekam... (15–60 detik, satu pembicara)', 'info')
    } catch (e: any) {
      setError(`Tidak bisa mengakses mikrofon: ${e.message}`)
    }
  }

  const canClone = !!file && !loading && !!authToken && !!name.trim() &&
    (isAdmin || covered || (wallet?.balance ?? 0) >= price)

  const runClone = async () => {
    if (!authToken) { addToast('⚠️ Login dulu untuk memakai Clone Voice.', 'warning'); return }
    if (!file) { addToast('⚠️ Pilih atau rekam sample audio dulu.', 'warning'); return }
    if (!name.trim()) { addToast('⚠️ Isi nama voice dulu (contoh: Suara Brand).', 'warning'); return }
    if (duration && (duration < MIN_SECONDS || duration > MAX_SECONDS)) {
      addToast(`⚠️ Durasi sample harus ${MIN_SECONDS}–${MAX_SECONDS} detik.`, 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setCloned(null)
    setLogs([])
    setStatusMsg('Menyiapkan...')
    chargeRef.current = null
    coveredRef.current = false

    try {
      if (!isAdmin) {
        addLog('[1/3] 💰 Memotong saldo NexaBot...', 'info')
        const charge = await chargeNexabotWallet(authToken, 'tts')
        chargeRef.current = charge.usageId
        coveredRef.current = charge.unlimited
        setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
        addLog(charge.unlimited
          ? '[1/3] 🎟️ Paket aktif — clone ini gratis'
          : `[1/3] 💰 Saldo terpotong ${formatRp(charge.deducted)} ✓ sisa ${formatRp(charge.balance)}`, 'success')
      }

      const auth = await buildAuth()
      setStatusMsg('Meng-clone suara...')
      addLog('[2/3] 🚀 Kirim sample ke NexaBot (Clone Voice)...', 'info')
      const voice = await submitNexabotVoiceClone({
        file,
        name: name.trim(),
        gender,
      }, auth)

      addLog(`[3/3] ✅ Voice dibuat ✓ id=${voice.id || '-'}`, 'success')
      setCloned(voice)
      setVoices((prev) => [{ ...voice }, ...prev.filter((v) => v.id !== voice.id)])
      if (voice.id) setSpeakerId(voice.id)
      addToast('Clone Voice selesai!', 'success')
      setStatusMsg('')
    } catch (err: any) {
      setError(err.message)
      setStatusMsg('')
      addLog(`❌ ${err.message}`, 'error')
      if (chargeRef.current && authToken && !isAdmin && !coveredRef.current) {
        const refunded = await refundNexabotWallet(authToken, chargeRef.current)
        if (refunded != null) {
          setWallet((w) => (w ? { ...w, balance: refunded } : w))
          addLog(`💸 Saldo dikembalikan ✓ sisa ${formatRp(refunded)}`, 'warn')
        }
      }
    } finally {
      chargeRef.current = null
      setLoading(false)
    }
  }

  const runElevenLabs = async () => {
    if (!authToken) { addToast('⚠️ Login dulu untuk memakai ElevenLabs.', 'warning'); return }
    if (!elText.trim()) { addToast('⚠️ Tulis script yang mau dijadikan suara dulu.', 'warning'); return }
    if (!speakerId) { addToast('⚠️ Pilih suara dulu (klik "Muat ulang" kalau daftar kosong).', 'warning'); return }

    setElLoading(true)
    setError(null)
    setElUrl(null)
    let usageId: number | null = null
    try {
      if (!isAdmin) {
        const charge = await chargeNexabotWallet(authToken, 'elevenlabs')
        usageId = charge.usageId
        chargeRef.current = charge.usageId
        coveredRef.current = charge.unlimited
        setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
        addLog(charge.unlimited
          ? '🎟️ Paket aktif — generate ElevenLabs gratis'
          : `💰 Saldo terpotong ${formatRp(charge.deducted)} ✓ sisa ${formatRp(charge.balance)}`, 'success')
      }
      const auth = await buildAuth()
      addLog(`🚀 Generate ElevenLabs (${selectedVoice ? voiceLabel(selectedVoice) : speakerId})...`, 'info')
      const url = await submitNexabotElevenLabs({
        speakerId,
        text: elText.trim(),
        languageCode: 'id-ID',
      }, auth)
      setElUrl(url)
      addLog('✅ Suara ElevenLabs selesai', 'success')
      addToast('Generate ElevenLabs selesai!', 'success')
    } catch (err: any) {
      setError(err.message)
      addLog(`❌ ${err.message}`, 'error')
      if (usageId && authToken && !isAdmin && !coveredRef.current) {
        const refunded = await refundNexabotWallet(authToken, usageId)
        if (refunded != null) setWallet((w) => (w ? { ...w, balance: refunded } : w))
      }
    } finally {
      chargeRef.current = null
      setElLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        title="🎤 Clone Voice"
        desc="Buat voice dari sample audio lewat nexabot.id (ElevenLabs). Upload WAV/M4A/MP3 atau rekam langsung. Maks 10 MB, 15–60 detik, satu pembicara."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {['🎙️ Upload atau rekam', '⏱️ 15–60 detik · maks 10 MB', '👤 Satu pembicara', `💠 ${formatRp(price)} / generate`].map((b) => (
          <span key={b} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{b}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai Clone Voice.
        </div>
      )}
      {authToken && wallet && (
        <div className="mb-6 text-xs text-muted-foreground">
          Saldo NexaBot: <strong className="text-foreground">{formatRp(wallet.balance)}</strong>
          {wallet.unlimited?.active ? ' · paket Unlimited aktif (gratis)' : ''}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="🎧 Sample Audio" className="!p-6">
          <input
            ref={inputRef}
            type="file"
            accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />

          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={recording || loading}>
              <Upload className="h-4 w-4 mr-2" /> Pilih file audio…
            </Button>
            {recording ? (
              <Button variant="secondary" onClick={stopRecording}>
                <Square className="h-4 w-4 mr-2" /> Stop ({recordSeconds}s)
              </Button>
            ) : (
              <Button variant="secondary" onClick={startRecording} disabled={loading}>
                <Mic className="h-4 w-4 mr-2" /> Rekam suara
              </Button>
            )}
            {file && (
              <Button
                variant="ghost"
                onClick={() => { setFile(null); setDuration(0); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Hapus
              </Button>
            )}
          </div>

          {file && (
            <div className="p-3 rounded-lg bg-surface-secondary border border-border">
              <div className="text-sm text-foreground truncate">{file.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {duration ? fmtSec(duration) : 'durasi tidak terbaca'}
              </div>
              {previewUrl && <audio src={previewUrl} controls className="w-full mt-2" />}
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Gunakan satu pembicara tanpa musik latar / noise berlebih. Durasi di luar 15–60 detik akan ditolak upstream.
          </p>
        </Section>

        <Section title="🎚️ Detail Voice" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">Nama voice</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Suara Brand"
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">Gender</Label>
            <div className="flex gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGender(g.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    gender === g.value ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={runClone} disabled={!canClone} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mic className="h-4 w-4 mr-2" />}
            {loading ? 'Memproses...' : 'Buat voice dari sample audio'}
          </Button>
          {statusMsg && <div className="mt-2 text-[11px] text-muted-foreground">{statusMsg}</div>}
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> <span className="break-words">{error}</span>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <Section title="🔊 ElevenLabs · Teks jadi Suara" className="!p-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              {selectedVoice ? voiceLabel(selectedVoice) : 'belum ada suara dipilih'}
            </span>
            <span className="text-[11px] text-muted-foreground">0,02 kredit per generate · {voices.length} suara</span>
            <Button variant="ghost" onClick={loadVoices} disabled={voicesLoading || !authToken}>
              {voicesLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Muat ulang
            </Button>
          </div>

          {voicesError && (
            <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-xs">
              Daftar suara gagal dimuat: {voicesError}
            </div>
          )}

          <div className="mb-3">
            <Label className="mb-2 block">Pilih suara</Label>
            <input
              value={voiceQuery}
              onChange={(e) => setVoiceQuery(e.target.value)}
              placeholder="Cari voice (mis. Marco, Jada, MiniMax)..."
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {/* Daftar kustom: popup <select> bawaan browser selalu putih. */}
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-surface-secondary">
              {voiceOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {voicesLoading ? 'Memuat daftar suara...' : 'Tidak ada voice cocok'}
                </div>
              ) : (
                voiceOptions.map((v) => (
                  <button
                    key={`${v.id}-${v.name}`}
                    type="button"
                    onClick={() => setSpeakerId(v.id)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      speakerId === v.id
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-background'
                    }`}
                  >
                    {voiceLabel(v)}
                  </button>
                ))
              )}
            </div>
          </div>

          <textarea
            value={elText}
            onChange={(e) => setElText(e.target.value)}
            placeholder="Type the script to speak… e.g. Welcome to the future of creativity, your imagination is the only limit."
            className="w-full h-28 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Button onClick={runElevenLabs} disabled={elLoading || !elText.trim() || !speakerId}>
              {elLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Volume2 className="h-4 w-4 mr-2" />}
              {elLoading ? 'Membuat suara...' : 'Generate ElevenLabs'}
            </Button>
            {elUrl && <audio src={elUrl} controls className="w-full sm:w-80" />}
          </div>
        </Section>
      </div>

      {cloned && (
        <div className="mt-6">
          <Section title="✅ Voice Siap" className="!p-6">
            <div className="flex items-center gap-2 text-sm text-green-400 mb-3">
              <CheckCircle2 className="h-4 w-4" /> Voice berhasil dibuat
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{cloned.name}</span>
              <span className="px-1.5 py-0.5 rounded bg-surface-secondary">{cloned.provider}</span>
              <code className="text-[10px] break-all">{cloned.id}</code>
              <Button
                variant="ghost"
                onClick={() => { navigator.clipboard?.writeText(cloned.id); addToast('Speaker ID disalin', 'success') }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Voice ini otomatis dipilih di panel ElevenLabs — tulis script lalu klik Generate ElevenLabs.
            </p>
          </Section>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-6">
          <Section title="📜 Log" className="!p-6">
            <div className="max-h-56 overflow-auto font-mono text-[11px] space-y-1">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === 'error' ? 'text-red-400'
                      : l.level === 'success' ? 'text-green-400'
                        : l.level === 'warn' ? 'text-yellow-400'
                          : 'text-muted-foreground'
                  }
                >
                  <span className="opacity-60">{l.time}</span> {l.msg}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </PageContent>
  )
}
