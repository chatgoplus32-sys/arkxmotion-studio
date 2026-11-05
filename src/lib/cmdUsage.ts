const KEY = 'arkxmotion.cmduse'

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function trackCmdUse(id: string) {
  const data = read()
  data[id] = (data[id] || 0) + 1
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (e) { console.warn('[cmduse] save failed', e) }
}

export function topFrequent(n: number): string[] {
  const data = read()
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id)
}

export function resetCmdUse() {
  try { localStorage.removeItem(KEY) } catch {}
}
