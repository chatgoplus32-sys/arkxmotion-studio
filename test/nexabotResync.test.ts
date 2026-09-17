// ─── Extension nexabot: kirim ulang cookie secara berkala ───────────────────
//
// Yang diuji di sini bukan bentuk kode, tapi perilakunya: file background.js
// dijalankan apa adanya di dalam sandbox `vm` dengan stub `chrome` dan `fetch`,
// lalu listener-nya dipicu seperti Chrome memicunya. Penjaga berbasis pola cuma
// bisa membuktikan sebuah fungsi "ada"; tes ini membuktikan fungsi itu benar-
// benar terpanggil saat alarm berbunyi, memakai identitas yang benar, dan diam
// ketika tidak ada yang bisa dikirim.
//
// Latar masalahnya: extension dulu HANYA mengirim cookie saat menangkapnya
// (tab nexabot.id selesai load / cookie berubah). Kalau kiriman itu tidak sampai
// — app belum dibuka, JWT app kedaluwarsa, server baru restart — cookie yang
// sudah diambil tidak pernah dikirim ulang, dan user harus menekan sync manual.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const EXT = path.join(ROOT, 'extensions', 'nexabot-token-ext')
const SUMBER = path.join(EXT, 'background.js')
const KODE = fs.readFileSync(SUMBER, 'utf8')

const APP_JWT = 'jwt-app-untuk-tes'
const COOKIE = 'session=sesi-nexabot-tersimpan; token=rahasia'
const JAM = 60 * 60 * 1000

interface FetchCall {
  url: string
  method: string
  auth: string | null
  body: Record<string, unknown> | null
}

/**
 * Jalankan background.js di sandbox dengan chrome + fetch tiruan.
 * `session` mengisi nxb_session yang sudah tersimpan, `appToken` mengatur apa
 * yang terbaca dari tab app (null = tidak ada tab app yang login).
 */
function jalankanExtension(opsi: { session?: Record<string, unknown> | null; appToken?: string | null } = {}) {
  const storage: Record<string, any> = {}
  if (opsi.session) storage.nxb_session = opsi.session

  const fetchCalls: FetchCall[] = []
  const alarmDibuat: { name: string; info: Record<string, unknown> }[] = []
  const listener: Record<string, (arg?: any) => any> = {}
  let alarmAda = false

  const chrome = {
    storage: {
      local: {
        get: async (key: unknown) => {
          if (typeof key === 'string') return key in storage ? { [key]: storage[key] } : {}
          const out: Record<string, unknown> = {}
          for (const k of (key as string[]) || []) if (k in storage) out[k] = storage[k]
          return out
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(storage, obj) },
        remove: async (keys: unknown) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k as string]
        },
      },
    },
    cookies: { getAll: async () => [], onChanged: { addListener: (fn: any) => { listener.cookieChanged = fn } } },
    tabs: { query: async () => [{ id: 1 }], onUpdated: { addListener: (fn: any) => { listener.tabUpdated = fn } } },
    scripting: {
      executeScript: async () => [{ result: opsi.appToken === undefined ? APP_JWT : opsi.appToken }],
    },
    alarms: {
      get: async () => (alarmAda ? { name: 'nxb-resync' } : undefined),
      create: (name: string, info: Record<string, unknown>) => {
        alarmDibuat.push({ name, info })
        alarmAda = true
      },
      onAlarm: { addListener: (fn: any) => { listener.alarm = fn } },
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    notifications: { create: () => {} },
    runtime: {
      onMessage: { addListener: (fn: any) => { listener.message = fn } },
      onStartup: { addListener: (fn: any) => { listener.startup = fn } },
      onInstalled: { addListener: (fn: any) => { listener.installed = fn } },
    },
  }

  const fetchPalsu = async (url: string, opts: any = {}) => {
    fetchCalls.push({
      url,
      method: opts.method || 'GET',
      auth: (opts.headers && opts.headers.Authorization) || null,
      body: opts.body ? JSON.parse(opts.body) : null,
    })
    return { ok: true, status: 200, json: async () => ({ ok: true, message: 'Token synced successfully' }) }
  }

  const sandbox: Record<string, any> = { chrome, fetch: fetchPalsu, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout }
  const ctx = createContext(sandbox)
  runInContext(KODE, ctx, { filename: SUMBER })

  const kiriman = () => fetchCalls.filter((c) => c.url.includes('/api/sync-tokens') && c.method === 'POST')

  return { sandbox, storage, fetchCalls, alarmDibuat, listener, kiriman }
}

async function tunggu(cek: () => boolean, batasMs = 3000): Promise<boolean> {
  const mulai = Date.now()
  while (Date.now() - mulai < batasMs) {
    if (cek()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return cek()
}

const sesi = (umurMs = 0) => ({ cookies: COOKIE, count: 2, capturedAt: Date.now() - umurMs, source: 'auto-nav' })

// ── Manifest & sintaks ──────────────────────────────────────────────────────

test('manifest memberi permission alarms dan berkasnya valid', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
  // Tanpa permission ini, chrome.alarms melempar di MV3 dan kirim ulang berkala
  // tidak akan pernah berjalan — kegagalannya senyap.
  assert.ok(manifest.permissions.includes('alarms'), 'permission "alarms" tidak ada di manifest')
  assert.ok(manifest.permissions.includes('scripting'), 'permission "scripting" hilang (dibutuhkan untuk membaca JWT app)')

  // Sintaks berkasnya harus benar-benar bisa dijalankan, bukan cuma enak dibaca.
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', SUMBER], { stdio: 'pipe' })
  }, 'background.js tidak lolos pemeriksaan sintaks')
})

// ── Alarm ───────────────────────────────────────────────────────────────────

test('alarm kirim-ulang dipasang, dan tidak direset setiap worker bangun', async () => {
  const env = jalankanExtension({ session: sesi() })

  assert.ok(await tunggu(() => env.alarmDibuat.length >= 1), 'alarm tidak pernah dipasang')
  const pertama = env.alarmDibuat[0]
  assert.match(pertama.name, /resync/i)
  assert.equal(pertama.info.periodInMinutes, 15, 'periode kirim ulang tidak seperti yang dimaksud')
  assert.ok(Number(pertama.info.delayInMinutes) <= 5, 'kiriman pertama terlalu lama setelah worker bangun')

  // Service worker MV3 bangun-tidur berkali-kali. Kalau `create` dipanggil ulang
  // setiap kali, jadwalnya (termasuk delay awal) ter-reset dan extension mengirim
  // ulang jauh lebih sering daripada tiap 15 menit.
  await env.sandbox.ensureResyncAlarm()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(env.alarmDibuat.length, 1, 'alarm dipasang ulang saat worker bangun, jadwalnya ter-reset')
})

test('saat alarm berbunyi, cookie tersimpan dikirim ulang dengan identitas app', async () => {
  const env = jalankanExtension({ session: sesi(2 * 60 * 1000) })
  assert.ok(await tunggu(() => env.alarmDibuat.length === 1))
  await new Promise((r) => setTimeout(r, 100)) // beri waktu kiriman awal runInContext selesai

  const sebelum = env.kiriman().length
  env.listener.alarm({ name: env.alarmDibuat[0].name })

  assert.ok(await tunggu(() => env.kiriman().length > sebelum), 'alarm tidak memicu kiriman ulang')
  const kirim = env.kiriman()[env.kiriman().length - 1]
  assert.match(kirim.url, /\/api\/sync-tokens$/)
  assert.equal(kirim.auth, `Bearer ${APP_JWT}`, 'kiriman ulang tanpa identitas → server akan menolak 401')
  assert.equal(kirim.body?.provider, 'nexabot')
  assert.equal(kirim.body?.kind, 'cookie', 'cookie sesi harus dikirim sebagai kind cookie')
  assert.equal(kirim.body?.token, COOKIE)
  assert.match(String(kirim.body?.source), /auto-resync/, 'sumber kiriman ulang tidak terbaca di riwayat')
})

test('cookie tersimpan yang lebih tua dari 24 jam tidak dikirim ulang, dan sebabnya dikatakan', async () => {
  // Server memangkas credential jenis cookie setelah 24 jam, jadi mengirim ulang
  // yang lebih tua hanya menghasilkan baris yang pasti dibuang.
  const env = jalankanExtension({ session: sesi(25 * JAM) })
  assert.ok(await tunggu(() => env.alarmDibuat.length === 1))
  await new Promise((r) => setTimeout(r, 100))

  const sebelum = env.kiriman().length
  env.listener.alarm({ name: env.alarmDibuat[0].name })
  await new Promise((r) => setTimeout(r, 300))

  assert.equal(env.kiriman().length, sebelum, 'cookie kedaluwarsa tetap dikirim ulang')
  const status = env.storage.nxb_last_sync_msg
  assert.ok(status, 'status tidak diperbarui, user tidak tahu kenapa tidak ada yang dikirim')
  assert.match(String(status.message), /24 jam/i)
})

test('tanpa cookie tersimpan: tidak mengirim apa pun dan tidak menimpa status', async () => {
  const env = jalankanExtension({ session: null })
  assert.ok(await tunggu(() => env.alarmDibuat.length === 1))
  await new Promise((r) => setTimeout(r, 100))

  env.listener.alarm({ name: env.alarmDibuat[0].name })
  await new Promise((r) => setTimeout(r, 300))

  assert.equal(env.kiriman().length, 0, 'ada kiriman padahal belum pernah menangkap cookie')
  assert.equal(env.storage.nxb_last_sync_msg, undefined, 'status terakhir ditimpa pesan yang tidak relevan')
})

test('browser dijalankan lagi memicu kirim ulang tanpa menunggu siklus pertama', async () => {
  const env = jalankanExtension({ session: sesi(JAM) })
  assert.ok(await tunggu(() => env.alarmDibuat.length === 1))
  await new Promise((r) => setTimeout(r, 100))

  const sebelum = env.kiriman().length
  env.listener.startup()
  assert.ok(await tunggu(() => env.kiriman().length > sebelum), 'restart browser tidak memicu kirim ulang')
})

test('tanpa JWT app: tidak ada POST ke server, dan status menyebut perlu login', async () => {
  const env = jalankanExtension({ session: sesi(), appToken: null })
  assert.ok(await tunggu(() => env.alarmDibuat.length === 1))
  await new Promise((r) => setTimeout(r, 100))

  env.listener.alarm({ name: env.alarmDibuat[0].name })
  await new Promise((r) => setTimeout(r, 400))

  assert.equal(env.kiriman().length, 0, 'kiriman tanpa identitas dikirim juga (pasti ditolak 401)')
  const status = env.storage.nxb_last_sync_msg
  assert.ok(status, 'status tidak diperbarui')
  assert.equal(status.ok, false)
  assert.match(String(status.message), /login/i)
})
