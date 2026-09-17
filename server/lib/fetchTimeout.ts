/**
 * Shared fetch wrapper with timeout protection.
 * Prevents upstream API hangs from causing 502 errors.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 30000
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(tid)
  }
}
