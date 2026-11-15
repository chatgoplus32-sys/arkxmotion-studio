#!/usr/bin/env node
/**
 * Migrasi token MF-… (MarkasKeyTool / "Markasflow") → access token RunningHub (JWT eyJ…)
 *
 * Untuk apa ini dibuat
 * --------------------
 * Token `MF-…` yang dibeli dari seller resmi bukanlah kredensial HTTP — kunci itu
 * dipakai sebagai "kunci akun" DI DALAM dashboard ai.markastools.id (menu Accounts →
 * Tambah Akun, provider RunningHub yang dilabeli "Markasflow"). Sedangkan pool
 * token RunningHub di ARKxMotion berisi access token murni (JWT HS512) seperti
 * yang ditandatangani server RunningHub.
 *
 * Alat ini mengotomatisasi langkah yang bisa diambil dengan session kamu sendiri:
 *   1. probe (GET) endpoint yang dipakai dashboard — /api/me, /api/stats,
 *      /api/accounts, /api/runninghub/accounts
 *   2. (opsional, --register) daftarkan tiap token MF- ke akun Markasflow
 *      lewat POST /api/runninghub/accounts — endpoint resmi yang dipakai app
 *   3. pindai SEMUA body respons untuk string berbentuk JWT `eyJ…`; yang exp-nya
 *      masih berlaku divalidasi (decode payload) lalu ditulis ke file output
 *
 * KENAPA MUNGKIN TIDAK MENEMUKAN APA-APA (batasan jujur)
 * -----------------------------------------------------
 * Tidak ada konversi kriptografis MF- → eyJ: tanda tangan JWT dibuat dengan
 * secret server RunningHub, bukan dari isi MF-. Konversi hanya bisa terjadi
 * kalau backend MarkasTools sendiri mengekspos token akun di responsnya.
 * Kalau backend memang tidak mengeksposnya, yang bisa dilakukan alat ini
 * hanya mendaftarkan MF- ke akun Markasflow (--register) — token eyJ memang
 * tidak pernah keluar dari server mereka. Dalam kasus itu, token murni harus
 * diminta ke seller (MarkasKeyTool) atau dipakai lewat jalur MarkasTools
 * (model "MarkasFlow" di app) sebagaimana adanya.
 *
 * Pakai
 * -----
 *   # 1) simpan cookie session ai.markastools.id ke file (dari extension
 *   #    markastools-cookie-extension, atau DevTools → Network → header Cookie)
 *   node scripts/migrate-markasflow-tokens.mjs --cookie-file .tmp/cookie.txt
 *
 *   # 2) sekaligus daftarkan daftar token MF- (satu per baris) sebagai akun Markasflow
 *   node scripts/migrate-markasflow-tokens.mjs --cookie-file .tmp/cookie.txt --keys-file .tmp/mf-tokens.txt --register
 *
 *   # 3) lihat token penuh di console (default hanya disajarkan tersamarkan)
 *   node scripts/migrate-markasflow-tokens.mjs --cookie-file .tmp/cookie.txt --show
 *
 * Opsi:
 *   --cookie <string>     cookie langsung (jangan dipakai di shared machine; prefer --cookie-file)
 *   --cookie-file <path>  file berisi header Cookie ("a=1; b=2") atau baris "Cookie: a=1; b=2"
 *   --keys "MF-a,MF-b"    daftar token MF- dipisah koma
 *   --keys-file <path>    file daftar token MF-, satu per baris (#komentar ok)
 *   --register            POST /api/runninghub/accounts tiap token MF- (aksi NYATA di akun kamu)
 *   --base <url>          default https://ai.markastools.id (atau env MARKASTOOLS_BASE)
 *   --out <path>          file kumpulan token eyJ valid (default: markasflow-tokens.txt)
 *   --dump <path>         file dump respons probe mentah (default: markasflow-probe.json)
 *   --show                cetak token penuh ke console
 *   --timeout <ms>        timeout per request (default 30000)
 *
 * Beroperasi hanya dengan session milik kamu di langganan milik kamu; tidak
 * mencapai akun orang lain. Token yang tertulis ke --out adalah kredensial
 * penuh — simpan dengan hati-hati, dan jangan commit file itu.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, env, exit } from 'node:process'

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g
const DEFAULT_BASE = 'https://ai.markastools.id'
const DEFAULT_OUT = 'markasflow-tokens.txt'
const DEFAULT_DUMP = 'markasflow-probe.json'
const PROBE_PATHS = ['/api/me', '/api/stats', '/api/accounts', '/api/runninghub/accounts']

function usage(code = 0) {
  const text = `Migrasi token MF- -> access token RunningHub (butuh session kamu sendiri)

  node scripts/migrate-markasflow-tokens.mjs --cookie-file .tmp/cookie.txt [--keys-file .tmp/mf.txt] [--register] [--show]

Opsi: --cookie --cookie-file --keys --keys-file --register --base --out --dump --show --timeout
Detail: baca komentar kepala file ini.`
  console.log(text)
  exit(code)
}

function parseArgs(list) {
  const opts = { register: false, show: false, timeout: 30000, base: (env.MARKASTOOLS_BASE || DEFAULT_BASE).replace(/\/+$/, ''), out: DEFAULT_OUT, dump: DEFAULT_DUMP }
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i]
    const next = () => { i += 1; if (i >= list.length) { console.error(`Opsi ${arg} butuh nilai.`); usage(1) } return list[i] }
    switch (arg) {
      case '--help': case '-h': usage(0); break
      case '--cookie': opts.cookie = next(); break
      case '--cookie-file': opts.cookieFile = next(); break
      case '--keys': opts.keys = next(); break
      case '--keys-file': opts.keysFile = next(); break
      case '--register': opts.register = true; break
      case '--show': opts.show = true; break
      case '--base': opts.base = next().replace(/\/+$/, ''); break
      case '--out': opts.out = next(); break
      case '--dump': opts.dump = next(); break
      case '--timeout': opts.timeout = Number(next()) || 30000; break
      default: console.error(`Opsi tidak dikenal: ${arg}`); usage(1)
    }
  }
  return opts
}

/** Normalisasi cookie: terima "a=1; b=2", "Cookie: a=1; b=2", atau cURL sisa. */
function normalizeCookie(raw) {
  let s = String(raw || '').replace(/[\r\n]+/g, ' ').trim()
  const headerMatch = s.match(/(?:^|[\s'"-])(?:cookie|Cookie):\s*(.+)$/i)
  if (headerMatch?.[1]) s = headerMatch[1].trim()
  s = s.replace(/^['"]+|['"]+$/g, '').replace(/^-+[Hh]\s*/, '').trim()
  return s.split(/\s{2,}(?=[A-Za-z-]+:)/)[0].trim()
}

function maskJwt(token) {
  const s = String(token)
  if (s.length <= 24) return `${s.slice(0, 6)}…${s.slice(-4)}`
  return `${s.slice(0, 14)}…${s.slice(-6)}`
}

function decodePayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch { return null }
}

/** Kumpulkan semua string JWT-like di dalam nilai JSON apa pun (rekursif). */
function collectJwts(value, acc = new Set(), depth = 0) {
  if (depth > 8 || value == null) return acc
  if (typeof value === 'string') {
    for (const m of value.matchAll(JWT_RE)) acc.add(m[0])
    return acc
  }
  if (Array.isArray(value)) { for (const v of value.slice(0, 50)) collectJwts(v, acc, depth + 1); return acc }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value).slice(0, 100)) {
      collectJwts(k, acc, depth + 1) // nama field bisa ikut menyimpan token (mis. "eyJ..." sebagai value di key aneh)
      collectJwts(v, acc, depth + 1)
    }
  }
  return acc
}

function collectJwtsFromText(text, acc = new Set()) {
  for (const m of String(text || '').matchAll(JWT_RE)) acc.add(m[0])
  return acc
}

async function request(url, cookie, timeout, init = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: {
        Cookie: cookie,
        Origin: url.origin,
        Referer: `${url.origin}/`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* respons non-JSON */ }
    return { status: res.status, ok: res.ok, text, json }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const opts = parseArgs(argv.slice(2))

  let rawCookie = opts.cookie
  if (opts.cookieFile) rawCookie = readFileSync(opts.cookieFile, 'utf8')
  const cookie = normalizeCookie(rawCookie)
  if (!cookie) { console.error('Cookie session kosong. Isi --cookie-file / --cookie (lihat --help).'); exit(1) }
  if (!cookie.includes('=')) { console.error('Cookie tidak berbentuk "nama=nilainya". Salin lengkap header Cookie dari ai.markastools.id.'); exit(1) }

  const base = opts.base
  console.log(`Target: ${base}`)
  console.log(`Cookie: ${cookie.length} karakter, ${cookie.split(';').length} pasangan nama=nilainya\n`)

  // ── 1) Probe (read-only) ──────────────────────────────────────
  const probe = {}
  for (const path of PROBE_PATHS) {
    const r = await request(new URL(path, base + '/'), cookie, opts.timeout, { method: 'GET' })
    probe[path] = { status: r.status, body: r.json ?? r.text.slice(0, 4000) }
    console.log(`GET ${path} → HTTP ${r.status}${r.json ? ' (json)' : ' (non-json)'}`)
  }

  // ── 2) (Opsional) daftarkan token MF- (aksi nyata) ────────────
  let keys = []
  if (opts.keys) keys = opts.keys.split(',').map((s) => s.trim()).filter(Boolean)
  if (opts.keysFile) {
    keys = keys.concat(
      readFileSync(opts.keysFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#')),
    )
  }
  keys = [...new Set(keys)]

  if (opts.register && keys.length) {
    console.log(`\nMendaftarkan ${keys.length} token MF- sebagai akun Markasflow (POST /api/runninghub/accounts)...`)
    for (const [i, key] of keys.entries()) {
      if (!/^MF-[A-Za-z0-9]+$/.test(key)) { console.log(`  [${i + 1}] ${key.slice(0, 8)}… DITOLAK (format bukan MF-…)`); continue }
      const r = await request(new URL('/api/runninghub/accounts', base + '/'), cookie, opts.timeout, {
        method: 'POST',
        body: JSON.stringify({ name: `markasflow-${i + 1}`, api_key: key }),
      })
      const sample = r.text.slice(0, 160).replace(/\s+/g, ' ')
      console.log(`  [${i + 1}] ${key.slice(0, 8)}… → HTTP ${r.status} ${sample}`)
    }
    // Refresh daftar akun setelah registrasi.
    for (const path of ['/api/accounts', '/api/runninghub/accounts']) {
      const r = await request(new URL(path, base + '/'), cookie, opts.timeout, { method: 'GET' })
      probe[`${path} (setelah register)`] = { status: r.status, body: r.json ?? r.text.slice(0, 4000) }
      console.log(`GET ${path} (setelah register) → HTTP ${r.status}`)
    }
  } else if (keys.length && !opts.register) {
    console.log(`\n${keys.length} token MF- dibacakan tapi TIDAK didaftarkan (tambahkan --register untuk mendaftarkan).`)
  }

  // ── 3) Kumpulkan & validasi kandidat JWT ─────────────────────
  const candidates = new Set()
  for (const entry of Object.values(probe)) {
    if (entry.body) { collectJwts(entry.body, candidates); collectJwtsFromText(typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body), candidates) }
  }

  const valid = []
  const expired = []
  for (const token of candidates) {
    const payload = decodePayload(token)
    if (!payload || typeof payload.exp !== 'number') continue
    ;(payload.exp * 1000 > Date.now() ? valid : expired).push({ token, payload })
  }

  console.log('\n════════ Ringkasan ════════')
  console.log(`Kandidat JWT ditemukan : ${candidates.size}`)
  console.log(`Masih berlaku          : ${valid.length}`)
  console.log(`Sudah kedaluwarsa      : ${expired.length}`)

  for (const { token, payload } of valid) {
    const created = payload.created ? new Date(payload.created).toISOString() : '?'
    const exp = new Date(payload.exp * 1000).toISOString()
    console.log(`\n  sub      : ${payload.sub ?? '?'}`)
    console.log(`  username : ${payload.username ?? '?'}`)
    console.log(`  created  : ${created}   exp: ${exp}`)
    console.log(`  token    : ${opts.show ? token : maskJwt(token)}`)
  }

  if (valid.length) {
    writeFileSync(opts.out, valid.map(({ token }) => token).join('\n') + '\n', 'utf8')
    console.log(`\n${valid.length} token ditulis ke: ${opts.out}`)
    console.log('PENTING: token itu adalah kredensial penuh — jangan commit / bagikan.')
  } else {
    writeFileSync(opts.dump, JSON.stringify(probe, null, 2), 'utf8')
    console.log(`\nTidak ada token eyJ yang valid ditemukan di respons.`)
    console.log(`Dump respons probe disimpan ke: ${opts.dump} — periksa manual apakah ada field`)
    console.log('seperti access_token / token / api_key / jwt. Kalau memang tidak ada,')
    console.log('token murni hanya bisa didapat dari seller (MarkasKeyTool) — daftarkan saja')
    console.log('MF- dengan --register dan pakai jalur MarkasTools.')
  }
}

main().catch((err) => { console.error('Gagal:', err?.message || err); exit(1) })
