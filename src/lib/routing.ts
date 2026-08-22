const ROUTING_KEY = 'arkxmotion.routing'

export function getRouting(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ROUTING_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function setRoutingValue(cap: string, providerId: string) {
  const routing = getRouting()
  routing[cap] = providerId
  localStorage.setItem(ROUTING_KEY, JSON.stringify(routing))
  window.dispatchEvent(new Event('aatools:routing-changed'))
}

export function getActiveProviderForCap(cap: string): string {
  const routing = getRouting()
  return routing[cap] || 'weavy'
}
