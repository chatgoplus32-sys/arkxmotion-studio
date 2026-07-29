import { useProviderManager, type ProviderId, type ProviderKey } from '@/stores/providerManager'
import { checkRoboneoBalance } from '@/lib/roboneo'

const TOKEN_ERROR_PATTERNS = [
  /token/i, /auth/i, /unauth/i, /forbidden/i,
  /expired/i, /invalid/i, /login/i, /log\s*in/i,
  /401/, /403/, /access.denied/i, /api.key/i,
  /rate.limit/i, /quota.exceeded/i,
]

const HTTP_AUTH_ERROR_CODES = [401, 403]

export function isTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  if (HTTP_AUTH_ERROR_CODES.some((c) => msg.includes(String(c)))) return true
  return TOKEN_ERROR_PATTERNS.some((p) => p.test(msg))
}

export function isFramiaTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /unauthorized|forbidden|invalid.*token|token.*invalid|expired|401|403/i.test(msg)
}

export function isRoboneoTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /token|auth|log\s*in|login|expired|unauth|401|403|insufficient|balance|credit|quota|charge|CHARGE_FAILED|余额|URL output tidak ditemukan|output tidak ditemukan|no output URL/i.test(msg)
}

export function isCreatePulseTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /unauthorized|forbidden|invalid.*key|key.*invalid|expired|401|403|api.*key/i.test(msg)
}

export function detectTokenError(provider: ProviderId, error: any): boolean {
  switch (provider) {
    case 'framia': return isFramiaTokenError(error)
    case 'roboneo': return isRoboneoTokenError(error)
    case 'createpulse': return isCreatePulseTokenError(error)
    default: return isTokenError(error)
  }
}

export interface RotateResult<T> {
  ok: boolean
  result?: T
  error?: string
  usedKey?: ProviderKey
  triedKeys: number
}

export async function withTokenRotation<T>(
  provider: ProviderId,
  fn: (apiKey: string, key: ProviderKey) => Promise<T>,
  opts?: {
    maxRetries?: number
    requiredCredits?: number
    onKeySwitch?: (from: ProviderKey, to: ProviderKey, attempt: number) => void
    onError?: (error: any, key: ProviderKey) => void
  }
): Promise<RotateResult<T>> {
  const store = useProviderManager.getState()
  const allKeys = store.keys[provider] || []
  const maxRetries = opts?.maxRetries ?? allKeys.length

  if (allKeys.length === 0) {
    return { ok: false, error: `No API keys for ${provider}`, triedKeys: 0 }
  }

  const triedKeyIds = new Set<string>()
  let lastError: any = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const currentKeys = useProviderManager.getState().keys[provider] || []
    const nextKey = currentKeys.find(
      (k) => !triedKeyIds.has(k.id) && (k.status === 'active' || k.status === 'unknown')
    ) || currentKeys.find((k) => !triedKeyIds.has(k.id))

    if (!nextKey) break

    triedKeyIds.add(nextKey.id)

    // Pre-check balance for Roboneo tokens before submitting
    if (provider === 'roboneo') {
      try {
        const balanceCheck = await checkRoboneoBalance(nextKey.key)
        if (!balanceCheck.ok) {
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" check failed (${balanceCheck.error}). Trying next...`)
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
          lastError = new Error(`Token ${nextKey.name} check failed: ${balanceCheck.error}`)
          opts?.onError?.(lastError, nextKey)
          continue
        }
        if (balanceCheck.isValidUser === false) {
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" is_valid_user=false. Removing...`)
          useProviderManager.getState().removeKey(provider, nextKey.id)
          lastError = new Error(`Token ${nextKey.name} tidak valid (is_valid_user=false)`)
          opts?.onError?.(lastError, nextKey)
          continue
        }
        const bal = balanceCheck.balance ?? 0
        const required = opts?.requiredCredits ?? 0
        if (bal <= 0) {
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${bal}). Trying next...`)
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', bal)
          lastError = new Error(`Token ${nextKey.name} balance kosong (${bal})`)
          opts?.onError?.(lastError, nextKey)
          continue
        }
        if (required > 0 && bal < required) {
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${bal} < required=${required}). Trying next...`)
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', bal)
          lastError = new Error(`Token ${nextKey.name} balance tidak cukup (${bal} < ${required})`)
          opts?.onError?.(lastError, nextKey)
          continue
        }
        console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance=${bal} >= required=${required}, is_valid_user=${balanceCheck.isValidUser}, proceeding...`)
        useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active', bal)
      } catch (err: any) {
        console.log(`[token-rotation] ${provider} balance check failed for "${nextKey.name}": ${err.message}, proceeding anyway`)
      }
    }

    try {
      const result = await fn(nextKey.key, nextKey)
      return { ok: true, result, usedKey: nextKey, triedKeys: triedKeyIds.size }
    } catch (err: any) {
      lastError = err
      opts?.onError?.(err, nextKey)

      if (detectTokenError(provider, err)) {
        if (provider === 'roboneo') {
          useProviderManager.getState().removeKey(provider, nextKey.id)
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" removed (${err.message}). Trying next...`)
        } else {
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" marked invalid (${err.message}). Trying next...`)
        }

        const nextValid = useProviderManager.getState().keys[provider]?.find(
          (k) => !triedKeyIds.has(k.id) && (k.status === 'active' || k.status === 'unknown')
        )
        if (nextValid) {
          opts?.onKeySwitch?.(nextKey, nextValid, attempt + 1)
        }
      } else {
        return { ok: false, error: err.message, triedKeys: triedKeyIds.size }
      }
    }
  }

  return {
    ok: false,
    error: lastError?.message || `All ${triedKeyIds.size} keys failed for ${provider}`,
    triedKeys: triedKeyIds.size,
  }
}
