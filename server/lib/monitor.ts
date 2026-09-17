/**
 * Server monitoring — request logging, metrics, uptime tracking.
 *
 * Usage:
 *   import { monitorMiddleware, getMetrics } from './monitor.js'
 *   app.use(monitorMiddleware)
 *   app.get('/api/metrics', (_req, res) => res.json(getMetrics()))
 */

import type { Request, Response, NextFunction } from 'express'

// ── In-memory metrics ring buffer (last 1000 requests) ────────
const MAX_LOG = 1000
const requestLog: Array<{
  method: string
  path: string
  status: number
  durationMs: number
  timestamp: number
}> = []

const counters = {
  totalRequests: 0,
  totalErrors: 0,       // 5xx
  totalClientErrors: 0, // 4xx
  totalTimeouts: 0,     // aborted
}

const serverStartedAt = Date.now()

// ── Request logger + metrics collector ─────────────────────────
export function monitorMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now()

  res.on('finish', () => {
    const durationMs = Date.now() - start
    const status = res.statusCode

    counters.totalRequests++
    if (status >= 500) counters.totalErrors++
    if (status >= 400 && status < 500) counters.totalClientErrors++

    requestLog.push({
      method: req.method,
      path: req.path,
      status,
      durationMs,
      timestamp: Date.now(),
    })
    if (requestLog.length > MAX_LOG) requestLog.shift()
  })

  res.on('close', () => {
    if (!res.writableFinished) {
      counters.totalTimeouts++
    }
  })

  next()
}

// ── Metrics snapshot ───────────────────────────────────────────
export function getMetrics() {
  const uptimeMs = Date.now() - serverStartedAt
  const recent = requestLog.slice(-100) // last 100 requests

  // Average response time (last 100 requests)
  const avgDurationMs = recent.length > 0
    ? Math.round(recent.reduce((a, r) => a + r.durationMs, 0) / recent.length)
    : 0

  // P95 response time
  const sorted = recent.map(r => r.durationMs).sort((a, b) => a - b)
  const p95DurationMs = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0

  // Error rate
  const errorRate = counters.totalRequests > 0
    ? ((counters.totalErrors / counters.totalRequests) * 100).toFixed(2)
    : '0.00'

  // Requests per minute (last 5 min)
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  const recentRequests = requestLog.filter(r => r.timestamp > fiveMinAgo)
  const requestsPerMin = Math.round(recentRequests.length / 5)

  // Status code distribution (last 100)
  const statusDistribution: Record<number, number> = {}
  for (const r of recent) {
    statusDistribution[r.status] = (statusDistribution[r.status] || 0) + 1
  }

  // Slowest endpoints (last 100)
  const pathStats: Record<string, { count: number; avgMs: number; maxMs: number }> = {}
  for (const r of recent) {
    const key = `${r.method} ${r.path}`
    if (!pathStats[key]) pathStats[key] = { count: 0, avgMs: 0, maxMs: 0 }
    pathStats[key].count++
    pathStats[key].avgMs = Math.round((pathStats[key].avgMs * (pathStats[key].count - 1) + r.durationMs) / pathStats[key].count)
    pathStats[key].maxMs = Math.max(pathStats[key].maxMs, r.durationMs)
  }
  const slowestEndpoints = Object.entries(pathStats)
    .sort((a, b) => b[1].avgMs - a[1].avgMs)
    .slice(0, 10)
    .map(([path, stats]) => ({ path, ...stats }))

  return {
    uptime: {
      startedAt: new Date(serverStartedAt).toISOString(),
      uptimeMs,
      uptimeHuman: formatUptime(uptimeMs),
    },
    requests: {
      total: counters.totalRequests,
      errors: counters.totalErrors,
      clientErrors: counters.totalClientErrors,
      timeouts: counters.totalTimeouts,
      errorRate: `${errorRate}%`,
      requestsPerMin,
    },
    performance: {
      avgDurationMs,
      p95DurationMs,
      statusDistribution,
      slowestEndpoints,
    },
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    nodeVersion: process.version,
  }
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (day > 0) return `${day}d ${hr % 24}h ${min % 60}m`
  if (hr > 0) return `${hr}h ${min % 60}m`
  return `${min}m ${sec % 60}s`
}
