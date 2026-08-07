import { useProviderManager, type ProviderId, type ProviderKey } from '@/stores/providerManager'
import { checkRoboneoBalance, isRoboneoCredentialError, isRoboneoBalanceError } from '@/lib/roboneo'
import { checkWeavyBalance } from '@/lib/weavy'
import { fetchLeonardoBalance } from '@/lib/leonardo'

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
  return isRoboneoCredentialError(msg) || isRoboneoBalanceError(msg)
}

export function isRoboneoCreditError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return isRoboneoBalanceError(msg)
}

export function isLeonardoCreditError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /insufficient|not enough|out of|balance|quota|exhaust|credit|payment|charge|402|apiCreditCost/i.test(msg)
}

export function isCreatePulseTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /unauthorized|forbidden|invalid.*key|key.*invalid|expired|401|403|api.*key/i.test(msg)
}

export function isWeavyTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /token|auth|log\s*in|login|expired|unauth|401|403|invalid.*token|token.*invalid|insufficient|balance|credit|quota|no output URL|output tidak ditemukan/i.test(msg)
}

export function isMagnificTokenError(error: any): boolean {
  if (!error) return false
  const msg = typeof error === 'string' ? error : error?.message || ''
  return /api.?key|unauthorized|forbidden|invalid.*key|key.*invalid|expired|401|403|auth/i.test(msg)
}

export function detectTokenError(provider: ProviderId, error: any): boolean {
  switch (provider) {
    case 'framia': return isFramiaTokenError(error)
    case 'roboneo': return isRoboneoTokenError(error)
    case 'createpulse': return isCreatePulseTokenError(error)
    case 'weavy': return isWeavyTokenError(error)
    case 'magnific': return isMagnificTokenError(error)
    case 'firefly': return /401|403|expired|unauthorized|invalid.*token/i.test(String(error?.message || error))
    case 'leonardo': return /insufficient|not enough|out of|balance|quota|exhaust|limit|too many|rate.?limit|402|401|403|unauthor|forbidden|expired|invalid.*token|token.*invalid|500|502|503|504|server error|network|fetch|timeout|graphql/i.test(String(error?.message || error))
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
    // Sort by balance descending for weavy (prefer higher balance tokens)
    const sortedKeys = provider === 'weavy'
      ? [...currentKeys].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
      : currentKeys
    const nextKey = sortedKeys.find(
      (k) => !triedKeyIds.has(k.id) && (k.status === 'active' || k.status === 'unknown')
    ) || sortedKeys.find((k) => !triedKeyIds.has(k.id))

    if (!nextKey) break

    triedKeyIds.add(nextKey.id)

    // Pre-check balance for Roboneo tokens before submitting
    if (provider === 'roboneo') {
      try {
        const balanceCheck = await checkRoboneoBalance(nextKey.key)
        if (!balanceCheck.ok) {
          // Like aacreative: if balance check fails, still try the token (it might work)
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" check failed (${balanceCheck.error}). Proceeding anyway...`)
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'unknown')
        } else {
          const bal = balanceCheck.balance ?? 0
          const required = opts?.requiredCredits ?? 0

          if (balanceCheck.isValidUser === false) {
            if (bal !== null && bal <= 0) {
              console.log(`[token-rotation] ${provider} key "${nextKey.name}" is_valid_user=false & balance=0. Skipping...`)
              useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
              lastError = new Error(`Token ${nextKey.name} tidak valid & balance kosong`)
              opts?.onError?.(lastError, nextKey)
              continue
            }
            // Like aacreative: if balance is unknown or has balance, proceed anyway
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" is_valid_user=false BUT balance=${bal}. Proceeding anyway...`)
            if (required > 0 && bal !== null && bal < required) {
              console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${bal} < required=${required}). Trying next...`)
              useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', bal)
              lastError = new Error(`Token ${nextKey.name} balance tidak cukup (${bal} < ${required})`)
              opts?.onError?.(lastError, nextKey)
              continue
            }
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active', bal)
          } else {
            if (bal !== null && bal <= 0) {
              console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${bal}). Trying next...`)
              useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', bal)
              lastError = new Error(`Token ${nextKey.name} balance kosong (${bal})`)
              opts?.onError?.(lastError, nextKey)
              continue
            }
            if (required > 0 && bal !== null && bal < required) {
              console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${bal} < required=${required}). Trying next...`)
              useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', bal)
              lastError = new Error(`Token ${nextKey.name} balance tidak cukup (${bal} < ${required})`)
              opts?.onError?.(lastError, nextKey)
              continue
            }
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance=${bal} >= required=${required}, is_valid_user=${balanceCheck.isValidUser}, proceeding...`)
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active', bal)
          }
        }
      } catch (err: any) {
        console.log(`[token-rotation] ${provider} balance check failed for "${nextKey.name}": ${err.message}, proceeding anyway`)
      }
    } else if (provider === 'weavy') {
      try {
        const result = await checkWeavyBalance(nextKey.key)
        const required = opts?.requiredCredits ?? 0
        if (result.ok) {
          const balance = result.balance
          if (balance !== null && balance !== undefined) {
            if (balance < required) {
              console.log(`[token-rotation] ${provider} key "${nextKey.name}" skipped (balance=${balance} < required=${required}). Trying next...`)
              useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', balance)
              lastError = new Error(`Token ${nextKey.name} balance tidak cukup (${balance} < ${required})`)
              opts?.onError?.(lastError, nextKey)
              continue
            }
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance=${balance} >= required=${required}, proceeding...`)
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active', balance)
          } else {
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance unknown, proceeding anyway...`)
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active')
          }
        } else {
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" token check failed (${result.error}), proceeding anyway...`)
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active')
        }
       } catch (err: any) {
         console.log(`[token-rotation] ${provider} balance check failed for "${nextKey.name}": ${err.message}, proceeding anyway`)
       }
     } else if (provider === 'leonardo') {
       try {
         const balanceResult = await fetchLeonardoBalance(nextKey.key)
         const required = opts?.requiredCredits ?? 0
         if (!balanceResult.ok) {
           console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance check failed (${balanceResult.message}). Proceeding anyway...`)
           useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'unknown')
         } else {
           const bal = balanceResult.balance ?? 0
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
           console.log(`[token-rotation] ${provider} key "${nextKey.name}" balance=${bal} >= required=${required}, proceeding...`)
           useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'active', bal)
         }
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
          if (isRoboneoCreditError(err)) {
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty')
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" credit/quota habis (${err.message}). Marking empty, trying next...`)
          } else {
            useProviderManager.getState().removeKey(provider, nextKey.id)
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" removed - auth error (${err.message}). Trying next...`)
          }
        } else if (provider === 'leonardo') {
          if (isLeonardoCreditError(err)) {
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty')
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" credit/quota habis (${err.message}). Marking empty, trying next...`)
          } else {
            useProviderManager.getState().removeKey(provider, nextKey.id)
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" removed - auth error (${err.message}). Trying next...`)
          }
        } else if (provider === 'weavy') {
          const errMsg = (err.message || '').toLowerCase()
          if (errMsg.includes('insufficient') || errMsg.includes('credit')) {
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'empty', 0)
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" credits habis (${err.message}). Marking empty, trying next...`)
          } else if (errMsg.includes('unauthorized') || errMsg.includes('401') || errMsg.includes('invalid')) {
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" marked invalid (${err.message}). Trying next...`)
          } else {
            useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
            console.log(`[token-rotation] ${provider} key "${nextKey.name}" marked invalid (${err.message}). Trying next...`)
          }
        } else {
          useProviderManager.getState().updateKeyStatus(provider, nextKey.id, 'invalid')
          console.log(`[token-rotation] ${provider} key "${nextKey.name}" marked invalid (${err.message}). Trying next...`)
        }

        const nextValid = useProviderManager.getState().keys[provider]?.find(
          (k) => !triedKeyIds.has(k.id) && (k.status === 'active' || k.status === 'unknown')
        ) || useProviderManager.getState().keys[provider]?.find(
          (k) => !triedKeyIds.has(k.id)
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
