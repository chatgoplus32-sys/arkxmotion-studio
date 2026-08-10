import { getResults, CompletedResult } from '@/lib/backgroundTasks'

export interface DashboardStats {
  totalGenerates: number
  successfulGenerates: number
  failedGenerates: number
  totalCredits: number
  avgDurationSec: number
  topModels: Array<{ model: string; count: number; provider: string }>
  topProviders: Array<{ provider: string; count: number; credits: number }>
  recentActivity: CompletedResult[]
  generatesByDay: Array<{ date: string; count: number }>
  successRate: number
}

function getFailedCount(): number {
  try {
    const logs = JSON.parse(localStorage.getItem('arkxmotion_bg_logs') || '[]')
    return logs.filter((l: any) => l.level === 'error' && l.msg.includes('Error:')).length
  } catch {
    return 0
  }
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function calculateStats(): DashboardStats {
  const results = getResults()
  const failedCount = getFailedCount()

  const totalGenerates = results.length + failedCount
  const successfulGenerates = results.length
  const totalCredits = results.reduce((sum, r) => sum + (r.credits || 0), 0)

  const durations = results.filter((r) => r.duration && r.duration > 0).map((r) => r.duration!)
  const avgDurationSec = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  const modelCounts: Record<string, { count: number; provider: string }> = {}
  results.forEach((r) => {
    const key = `${r.model || 'unknown'}`
    if (!modelCounts[key]) modelCounts[key] = { count: 0, provider: r.provider || 'unknown' }
    modelCounts[key].count++
  })
  const topModels = Object.entries(modelCounts)
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const providerCounts: Record<string, { count: number; credits: number }> = {}
  results.forEach((r) => {
    const p = r.provider || 'unknown'
    if (!providerCounts[p]) providerCounts[p] = { count: 0, credits: 0 }
    providerCounts[p].count++
    providerCounts[p].credits += r.credits || 0
  })
  const topProviders = Object.entries(providerCounts)
    .map(([provider, data]) => ({ provider, ...data }))
    .sort((a, b) => b.count - a.count)

  const dayCounts: Record<string, number> = {}
  results.forEach((r) => {
    const day = getDateKey(r.date)
    dayCounts[day] = (dayCounts[day] || 0) + 1
  })
  const generatesByDay = Object.entries(dayCounts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)

  const successRate = totalGenerates > 0 ? Math.round((successfulGenerates / totalGenerates) * 100) : 0

  const recentActivity = results.slice(0, 10)

  return {
    totalGenerates,
    successfulGenerates,
    failedGenerates: failedCount,
    totalCredits,
    avgDurationSec,
    topModels,
    topProviders,
    recentActivity,
    generatesByDay,
    successRate,
  }
}
