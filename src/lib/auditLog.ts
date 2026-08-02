const AUDIT_KEY = 'arkxmotion.audit_log'
const MAX_ENTRIES = 200

export interface AuditEntry {
  id: string
  action: string
  detail: string
  user?: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'success'
}

export function logAudit(action: string, detail: string, level: AuditEntry['level'] = 'info', user?: string) {
  try {
    const entries = getAuditLog()
    const entry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      detail,
      user,
      timestamp: Date.now(),
      level,
    }
    entries.unshift(entry)
    localStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {}
}

export function getAuditLog(): AuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]')
  } catch {
    return []
  }
}

export function clearAuditLog() {
  localStorage.removeItem(AUDIT_KEY)
}

export function getAuditLogCount(): number {
  return getAuditLog().length
}
