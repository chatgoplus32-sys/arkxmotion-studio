/**
 * Server alert system — sends alerts via Telegram/Discord webhook.
 *
 * Env vars:
 *   ALERT_WEBHOOK_URL  — Telegram bot URL or Discord webhook URL
 *   ALERT_SECRET       — optional HMAC secret for webhook verification
 *
 * Usage:
 *   import { alertError, alertRecovery, checkHealth } from './alerts.js'
 *   alertError('API timeout', { endpoint: '/api/public/leonardo', upstream: 504 })
 */

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || ''
const SERVER_NAME = process.env.SERVER_NAME || 'arkxmotion-studio'

// Cooldown: don't spam same alert within 5 minutes
const cooldowns = new Map<string, number>()
const COOLDOWN_MS = 5 * 60 * 1000

// ── Send alert ────────────────────────────────────────────────
async function sendAlert(title: string, message: string, level: 'error' | 'warn' | 'info' = 'error') {
  if (!WEBHOOK_URL) {
    console.log(`[alert:${level}] ${title}: ${message}`)
    return
  }

  const emoji = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🟢'
  const color = level === 'error' ? 0xff0000 : level === 'warn' ? 0xffaa00 : 0x00ff00

  // Detect Discord vs Telegram
  const isDiscord = WEBHOOK_URL.includes('discord.com')

  try {
    if (isDiscord) {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `${emoji} ${title}`,
            description: message,
            color,
            timestamp: new Date().toISOString(),
            footer: { text: SERVER_NAME },
          }],
        }),
      })
    } else {
      // Telegram
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${emoji} *${title}*\n\n${message}\n\n_Server: ${SERVER_NAME}_`,
          parse_mode: 'Markdown',
        }),
      })
    }
  } catch (err: any) {
    console.error('[alert] Failed to send alert:', err.message)
  }
}

// ── Public API ────────────────────────────────────────────────
export function alertError(title: string, details?: Record<string, any>) {
  const key = `error:${title}`
  if (cooldowns.has(key) && Date.now() - cooldowns.get(key)! < COOLDOWN_MS) return
  cooldowns.set(key, Date.now())

  const message = details
    ? Object.entries(details).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    : 'No additional details'
  sendAlert(title, message, 'error')
}

export function alertRecovery(title: string, details?: Record<string, any>) {
  const message = details
    ? Object.entries(details).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    : 'Service recovered'
  sendAlert(`✅ RECOVERED: ${title}`, message, 'info')
}

export function alertWarn(title: string, details?: Record<string, any>) {
  const key = `warn:${title}`
  if (cooldowns.has(key) && Date.now() - cooldowns.get(key)! < COOLDOWN_MS) return
  cooldowns.set(key, Date.now())

  const message = details
    ? Object.entries(details).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    : 'No additional details'
  sendAlert(title, message, 'warn')
}

// ── Health check with upstream probing ────────────────────────
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  uptime: number
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>
}

const upstreams: Record<string, string> = {
  database: 'internal',
  createpulse: 'https://createpulse.online/api/status',
  framia: 'https://api.framia.pro/video/api',
  runninghub: 'https://www.runninghub.ai/enterprise-api/consumerApi',
}

export async function checkHealth(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {}
  let overallStatus: HealthCheckResult['status'] = 'ok'

  // Check database
  try {
    const db = (await import('../db.js')).default
    db.prepare('SELECT 1').get()
    checks.database = { status: 'ok' }
  } catch (err: any) {
    checks.database = { status: 'error', error: err.message }
    overallStatus = 'error'
  }

  // Check upstream APIs (fast probe, 5s timeout)
  for (const [name, url] of Object.entries(upstreams)) {
    if (url === 'internal') continue
    try {
      const start = Date.now()
      const ac = new AbortController()
      const tid = setTimeout(() => ac.abort(), 5000)
      const res = await fetch(url, { method: 'HEAD', signal: ac.signal })
      clearTimeout(tid)
      const latencyMs = Date.now() - start
      checks[name] = { status: res.ok ? 'ok' : 'degraded', latencyMs }
      if (!res.ok && overallStatus === 'ok') overallStatus = 'degraded'
    } catch (err: any) {
      checks[name] = { status: 'error', error: err.message }
      if (overallStatus === 'ok') overallStatus = 'degraded'
    }
  }

  const result: HealthCheckResult = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  }

  // Alert on status change
  if (overallStatus === 'error') {
    alertError('Health check failed', {
      status: overallStatus,
      checks: JSON.stringify(checks),
    })
  }

  return result
}
