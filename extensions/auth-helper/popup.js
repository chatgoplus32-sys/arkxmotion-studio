// ─── Popup auth-helper ───────────────────────────────────────────────────────
// Seluruh UI dibangun dari registry (providers.js) + snapshot dari background,
// jadi tidak ada daftar provider yang di-hardcode di sini. Tombol yang tidak
// relevan untuk provider aktif (mis. Refresh untuk Firefly) otomatis dimatikan
// karena kemampuan itu ikut dikirim background.

import { COPY_LABELS } from './providers.js'
import { expiryLabel } from './lib/jwt.js'
import { bestEntry, copyPayloadFor, maskToken } from './lib/tokens.js'

const $ = (id) => document.getElementById(id)

let state = null
let activeId = null

/** Kirim pesan ke background dan selalu mengembalikan objek (tidak melempar). */
function ask(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      resolve(response || { ok: false, error: 'tidak ada respons dari background' })
    })
  })
}

function toast(message, isError = false) {
  const el = $('toast')
  el.textContent = message
  el.className = 'toast show' + (isError ? ' error' : '')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => {
    el.className = 'toast'
  }, 2600)
}

function showResult(lines) {
  const el = $('result')
  const text = (Array.isArray(lines) ? lines.join('\n') : String(lines || '')).trim()
  el.textContent = text
  el.hidden = !text
}

const provider = () => (state ? state.providers.find((p) => p.id === activeId) : null)
const tokens = () => (state && state.tokens && activeId ? state.tokens[activeId] || [] : [])

// ── Render ───────────────────────────────────────────────────────────────────

function renderTabs() {
  const nav = $('tabs')
  nav.textContent = ''
  for (const item of state.providers) {
    const button = document.createElement('button')
    button.className = 'tab' + (item.id === activeId ? ' active' : '')
    button.dataset.id = item.id
    button.innerHTML = `${item.emoji} ${item.label} <span class="count">${item.count || ''}</span>`
    button.addEventListener('click', () => {
      activeId = item.id
      render()
    })
    nav.appendChild(button)
  }
}

function renderHeader() {
  const p = provider()
  if (!p) return
  document.documentElement.style.setProperty('--ink', p.ink)
  $('logo').textContent = p.emoji
  $('title').textContent = p.label
  const parts = [state.activeTabHost || 'tab ini']
  if (p.hosts.includes(state.activeTabHost)) parts.push('tab ini cocok')
  parts.push(`${tokens().length} token tersimpan`)
  $('subtitle').textContent = parts.join(' · ')
  $('hint').textContent = p.hint
}

function renderActions() {
  const p = provider()
  $('scanBtn').disabled = !p.canScan
  $('refreshBtn').disabled = !p.canRefresh
  $('balanceBtn').disabled = !p.canBalance
  $('diagBtn').hidden = p.id !== 'oneover'
  $('scanBtn').textContent = p.hosts.length ? '🔍 Scan tab provider' : '🔍 Scan tab aktif'
  $('syncNowBtn').disabled = !p.canSync
  $('syncNowBtn').title = p.canSync
    ? 'Kirim token terbaik provider ini ke app sekarang'
    : p.label + ' belum punya jalur auto-sync'
}

/** Baris status auto-sync provider aktif: hasil percobaan terakhir + waktunya. */
function renderSyncNote() {
  const p = provider()
  const el = $('syncNote')
  if (!p || !p.canSync) {
    el.textContent = 'Provider ini belum punya jalur auto-sync — token tetap disalin manual.'
    el.className = 'syncnote'
    return
  }
  const status = state.syncStatuses ? state.syncStatuses[p.id] : null
  if (!status) {
    el.textContent = 'Belum pernah dikirim. Buka tab app sambil login, token akan terkirim sendiri.'
    el.className = 'syncnote'
    return
  }
  const when = new Date(status.at).toLocaleTimeString('id-ID')
  el.textContent = `${status.ok ? '✓' : '✗'} ${status.message} · ${when}${status.origin ? ' · ' + status.origin : ''}`
  el.className = 'syncnote ' + (status.ok ? 'ok' : 'bad')
}

function cardActions(entry, index) {
  const p = provider()
  const row = document.createElement('div')
  row.className = 'row'

  const copy = document.createElement('button')
  copy.className = 'btn btn-primary btn-sm'
  copy.textContent = COPY_LABELS[p.copy] || COPY_LABELS.raw
  copy.addEventListener('click', () => copyEntry(entry, p.copy))
  row.appendChild(copy)

  for (const extra of p.extras || []) {
    const button = document.createElement('button')
    button.className = 'btn btn-sm'
    button.textContent = COPY_LABELS[extra] || `Copy ${extra}`
    button.addEventListener('click', () => copyEntry(entry, extra))
    row.appendChild(button)
  }

  if (p.canRefresh && entry.refreshToken) {
    const refresh = document.createElement('button')
    refresh.className = 'btn btn-sm'
    refresh.textContent = '♻️ Refresh'
    refresh.addEventListener('click', () => runRefresh(index))
    row.appendChild(refresh)
  }

  const remove = document.createElement('button')
  remove.className = 'btn btn-sm btn-danger'
  remove.textContent = '✕'
  remove.title = 'Hapus token ini'
  remove.addEventListener('click', async () => {
    await ask({ type: 'remove', providerId: p.id, key: index })
    await load()
    toast('Token dihapus')
  })
  row.appendChild(remove)
  return row
}

function renderTokens() {
  const container = $('tokens')
  container.textContent = ''
  const list = tokens()
  if (!list.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.innerHTML = 'Belum ada token tersimpan.<br>Buka situs provider sambil login, lalu klik Scan.'
    container.appendChild(empty)
    return
  }
  const best = bestEntry(list)
  for (let index = 0; index < list.length; index++) {
    const entry = list[index]
    const card = document.createElement('div')
    card.className = 'card'

    const who = document.createElement('div')
    who.className = 'who'
    who.textContent = entry.email || entry.sub || maskToken(entry.token || entry.refreshToken)
    card.appendChild(who)

    const meta = document.createElement('div')
    meta.className = 'meta'
    const expiry = entry.exp
      ? `<span class="${entry.exp > Date.now() ? 'alive' : 'expired'}">${expiryLabel(entry.exp)}</span>`
      : 'tanpa masa berlaku'
    const when = entry.capturedAt ? ` · diambil ${new Date(entry.capturedAt).toLocaleString('id-ID')}` : ''
    meta.innerHTML = `${expiry}${entry.refreshToken ? ' · punya refresh token' : ''}${when}`
    card.appendChild(meta)

    const preview = document.createElement('div')
    preview.className = 'preview'
    preview.textContent = maskToken(entry.token || entry.refreshToken)
    card.appendChild(preview)

    if (entry.source) {
      const source = document.createElement('div')
      source.className = 'meta'
      source.textContent = `sumber: ${entry.source}${entry === best ? ' · dipakai tombol Copy & buka' : ''}`
      card.appendChild(source)
    }

    card.appendChild(cardActions(entry, index))
    container.appendChild(card)
  }
}

function render() {
  renderTabs()
  renderHeader()
  renderActions()
  renderSyncNote()
  renderTokens()
}

// ── Aksi ─────────────────────────────────────────────────────────────────────

async function copyEntry(entry, format) {
  const payload = copyPayloadFor(provider(), entry, format)
  if (!payload) {
    toast('Token kosong untuk format itu', true)
    return
  }
  try {
    await navigator.clipboard.writeText(payload)
    toast('Tersalin — tempel di halaman Providers')
  } catch {
    showResult([payload])
    toast('Clipboard diblokir; token ditampilkan di panel hasil', true)
  }
}

async function load() {
  state = await ask({ type: 'state' })
  if (!state || !state.ok) {
    showResult(['Gagal memuat state: ' + ((state && state.error) || 'tidak diketahui')])
    return
  }
  if (!activeId || !state.providers.some((p) => p.id === activeId)) {
    activeId = state.activeProviderId || state.providers[0].id
  }
  $('appUrl').value = state.appUrl || ''
  $('syncToggle').checked = state.syncEnabled !== false
  render()
}

async function runScan() {
  const p = provider()
  $('scanBtn').disabled = true
  showResult(`Memindai token ${p.label}…`)
  const result = await ask({ type: 'scan', providerId: p.id })
  await load()
  if (result.ok) {
    const hosts = (result.tabs || []).length ? ` (tab: ${result.tabs.join(', ')})` : ''
    showResult([`Ditemukan ${result.found} kandidat, ${result.stored} tersimpan${hosts}`])
  } else {
    showResult(['Scan gagal: ' + result.error])
  }
}

async function runRefresh(index) {
  const p = provider()
  showResult(`Menukar refresh token ${p.label}…`)
  const result = await ask({ type: 'refresh', providerId: p.id, key: index })
  await load()
  showResult(
    result.ok
      ? [`Refresh berhasil — access token baru (${result.expiresIn}s)`]
      : [`Refresh gagal: ${result.error}`],
  )
}

async function runBalance() {
  const p = provider()
  $('balanceBtn').disabled = true
  showResult(`Mengecek saldo ${p.label}…`)
  const result = await ask({ type: 'balance', providerId: p.id })
  $('balanceBtn').disabled = false
  if (result.ok) {
    const value = result.balance == null ? 'tidak dilaporkan API' : String(result.balance)
    showResult(
      [`Saldo ${p.label}: ${value}`, result.raw ? JSON.stringify(result.raw).slice(0, 300) : ''].filter(Boolean),
    )
  } else {
    showResult(['Cek saldo gagal: ' + result.error])
  }
}

/** Kirim token provider aktif ke app sekarang (dipakai tombol & saat sync dinyalakan). */
async function runSyncNow(silent) {
  const p = provider()
  if (!p || !p.canSync) {
    if (!silent) toast('Provider ini belum punya jalur auto-sync', true)
    return
  }
  if (!silent) showResult([`Mengirim token ${p.label} ke app…`])
  const result = await ask({ type: 'sync_now', providerId: p.id })
  await load()
  if (!silent || !result.ok) {
    showResult([result.ok ? `Terkirim ke ${result.origin || 'app'}` : `Kirim gagal: ${result.error}`])
  }
  toast(result.ok ? `Token ${p.label} terkirim ke app` : 'Gagal: ' + result.error, !result.ok)
}

async function runDiagnostics() {
  showResult('Menjalankan diagnostik…')
  const result = await ask({ type: 'diagnostics', providerId: provider().id })
  showResult(result.ok ? result.lines : ['Diagnostik gagal: ' + result.error])
}

// ── Pemasangan event ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('scanBtn').addEventListener('click', runScan)
  $('refreshBtn').addEventListener('click', () => runRefresh(null))
  $('balanceBtn').addEventListener('click', runBalance)
  $('diagBtn').addEventListener('click', runDiagnostics)

  $('addBtn').addEventListener('click', async () => {
    const result = await ask({ type: 'add', providerId: provider().id, text: $('addInput').value })
    await load()
    toast(result.ok ? `${result.stored} token disimpan` : 'Gagal: ' + result.error, !result.ok)
    if (result.ok) $('addInput').value = ''
  })

  document.querySelector('[data-action="clear"]').addEventListener('click', async () => {
    const p = provider()
    if (!p) return
    await ask({ type: 'clear', providerId: p.id })
    await load()
    toast('Token ' + p.label + ' dikosongkan')
  })

  $('saveAppUrl').addEventListener('click', async () => {
    await ask({ type: 'app_url', url: $('appUrl').value.trim() })
    toast('App URL disimpan')
  })

  $('syncToggle').addEventListener('change', async (event) => {
    const wanted = event.target.checked
    const result = await ask({ type: 'set_sync_enabled', enabled: wanted })
    if (!result.ok) {
      event.target.checked = !wanted
      toast('Gagal menyimpan pengaturan sync: ' + result.error, true)
      return
    }
    state.syncEnabled = result.enabled
    toast(result.enabled ? 'Auto-sync aktif' : 'Auto-sync dimatikan')
    // Saat dinyalakan, langsung kirim yang tersimpan — user tidak perlu klik lagi.
    if (result.enabled) await runSyncNow(true)
  })

  $('syncNowBtn').addEventListener('click', () => runSyncNow(false))

  $('openProviders').addEventListener('click', async () => {
    const p = provider()
    const entry = bestEntry(tokens())
    if (entry) {
      try {
        await navigator.clipboard.writeText(copyPayloadFor(p, entry, p.copy))
      } catch {
        /* tetap buka tabnya walau clipboard ditolak */
      }
    }
    const base = ($('appUrl').value || state.defaultAppUrl || '').trim().replace(/\/+$/, '')
    chrome.tabs.create({ url: base + '/providers' })
    toast(entry ? 'Token disalin & Providers dibuka' : 'Providers dibuka (belum ada token tersimpan)', !entry)
  })

  load()
})
