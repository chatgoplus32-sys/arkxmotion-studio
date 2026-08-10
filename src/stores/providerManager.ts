import { create } from 'zustand'

export type ProviderId = 'weavy' | 'wavespeed' | 'magnific' | 'roboneo' | 'runninghub' | 'createpulse' | 'framia' | 'firefly' | 'leonardo' | 'gemini' | 'openai' | 'shotstack' | 'creatomate' | 'galleri5'

export interface ProviderKey {
  id: string
  key: string
  name?: string
  status: 'active' | 'expired' | 'invalid' | 'empty' | 'unknown'
  balance?: number | null
  email?: string
  lastChecked?: number
}

export interface ProviderConfig {
  id: ProviderId
  name: string
  icon: string
  description: string
  keyPlaceholder: string
  keyFormat: string
  minCredits: number
  supportsBalance: boolean
}

export interface MaintenanceInfo {
  isMaintenance: boolean
  message: string
}

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  weavy: {
    id: 'weavy',
    name: 'Weavy',
    icon: '🌊',
    description: 'AI video generation platform with Kling, Sora, and more',
    keyPlaceholder: 'Paste your Weavy token...',
    keyFormat: 'JWT token or API key',
    minCredits: 5,
    supportsBalance: true,
  },
  wavespeed: {
    id: 'wavespeed',
    name: 'Wavespeed',
    icon: '⚡',
    description: 'Fast AI image and video generation',
    keyPlaceholder: 'Paste your Wavespeed API key...',
    keyFormat: 'API key',
    minCredits: 0.01,
    supportsBalance: true,
  },
  magnific: {
    id: 'magnific',
    name: 'Magnific',
    icon: '✨',
    description: 'AI upscaling and enhancement',
    keyPlaceholder: 'Paste your Magnific API key...',
    keyFormat: 'API key',
    minCredits: 0,
    supportsBalance: false,
  },
  roboneo: {
    id: 'roboneo',
    name: 'Roboneo',
    icon: '🤖',
    description: 'AI video generation with Seedance, Kling, and more',
    keyPlaceholder: 'Paste your Roboneo access token...',
    keyFormat: 'Access token (_v2...)',
    minCredits: 1,
    supportsBalance: true,
  },
  runninghub: {
    id: 'runninghub',
    name: 'Motion Control HD (Markasflow-V2)',
    icon: '🚀',
    description: 'RunningHub AI video generation via Markasflow-V2',
    keyPlaceholder: 'Paste your RunningHub API key...',
    keyFormat: 'API key (32 chars)',
    minCredits: 0,
    supportsBalance: false,
  },
  createpulse: {
    id: 'createpulse',
    name: 'CreatePulse',
    icon: '💜',
    description: 'AI-powered video creation and editing platform',
    keyPlaceholder: 'Paste your CreatePulse API key...',
    keyFormat: 'API key',
    minCredits: 10,
    supportsBalance: true,
  },
  framia: {
    id: 'framia',
    name: 'Framia',
    icon: '🎬',
    description: 'AI video and image generation via Converge AI workflows',
    keyPlaceholder: 'Paste your Framia Bearer token...',
    keyFormat: 'Bearer token (JWT)',
    minCredits: 1,
    supportsBalance: true,
  },
  firefly: {
    id: 'firefly',
    name: 'Firefly',
    icon: '🔥',
    description: 'Adobe Firefly video generation (Veo 3.1, Firefly Video)',
    keyPlaceholder: 'Paste your Firefly Bearer token...',
    keyFormat: 'Bearer token',
    minCredits: 5,
    supportsBalance: true,
  },
  leonardo: {
    id: 'leonardo',
    name: 'Leonardo',
    icon: '🎨',
    description: 'Leonardo AI video generation (Seedance, Kling, Veo, Wan, Gemini)',
    keyPlaceholder: 'Paste your Leonardo Bearer JWT (eyJ...eyJ...)',
    keyFormat: 'Bearer JWT (Cognito)',
    minCredits: 10,
    supportsBalance: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    icon: '💎',
    description: 'Google AI for text generation and analysis',
    keyPlaceholder: 'Paste your Gemini API key...',
    keyFormat: 'API key',
    minCredits: 0,
    supportsBalance: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    description: 'GPT models for text generation',
    keyPlaceholder: 'Paste your OpenAI API key...',
    keyFormat: 'API key',
    minCredits: 0,
    supportsBalance: false,
  },
  shotstack: {
    id: 'shotstack',
    name: 'Shotstack',
    icon: '🎬',
    description: 'Cloud video rendering API — fallback for large files (≥400MB)',
    keyPlaceholder: 'Paste your Shotstack API key...',
    keyFormat: 'API key',
    minCredits: 0,
    supportsBalance: true,
  },
  creatomate: {
    id: 'creatomate',
    name: 'Creatomate',
    icon: '🎥',
    description: 'Cloud video rendering — template-based, batch rendering support',
    keyPlaceholder: 'Paste your Creatomate API key...',
    keyFormat: 'API key',
    minCredits: 0,
    supportsBalance: true,
  },
  galleri5: {
    id: 'galleri5',
    name: 'G5 AI Studio',
    icon: '🎬',
    description: 'Galleri5 AI Studio — Kling motion control via session-based auth',
    keyPlaceholder: 'Paste your G5 session_id...',
    keyFormat: 'Session ID (from browser cookie)',
    minCredits: 0,
    supportsBalance: false,
  },
}

function getDefaultMaintenance(): Record<ProviderId, MaintenanceInfo> {
  return {
    weavy: { isMaintenance: false, message: '' },
    wavespeed: { isMaintenance: false, message: '' },
    magnific: { isMaintenance: false, message: '' },
    roboneo: { isMaintenance: false, message: '' },
    runninghub: { isMaintenance: false, message: '' },
    createpulse: { isMaintenance: false, message: '' },
    framia: { isMaintenance: false, message: '' },
    firefly: { isMaintenance: false, message: '' },
    leonardo: { isMaintenance: false, message: '' },
    gemini: { isMaintenance: false, message: '' },
    openai: { isMaintenance: false, message: '' },
    shotstack: { isMaintenance: false, message: '' },
    creatomate: { isMaintenance: false, message: '' },
    galleri5: { isMaintenance: false, message: '' },
  }
}

function isValidLeonardoJwt(token: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.trim()) &&
         !isTokenExpired(token)
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token)
  if (!payload?.exp) return false
  return Date.now() > payload.exp * 1000
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    if (typeof atob === 'function') {
      return JSON.parse(atob(padded))
    }
    const bytes = Uint8Array.from(padded, (c) => c.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export type ProviderState = {
  keys: Record<ProviderId, ProviderKey[]>
  activeProvider: ProviderId
  routing: Record<string, ProviderId>
  maintenance: Record<ProviderId, MaintenanceInfo>

  setActiveProvider: (provider: ProviderId) => void
  addKey: (provider: ProviderId, key: string, name?: string) => void
  importKeys: (provider: ProviderId, tokenValues: string[], namePrefix?: string) => number
  removeKey: (provider: ProviderId, keyId: string) => void
  updateKeyStatus: (provider: ProviderId, keyId: string, status: ProviderKey['status'], balance?: number, email?: string) => void
  getActiveKey: (provider: ProviderId) => ProviderKey | null
  getFirstValidKey: (provider: ProviderId) => ProviderKey | null
  findKeyById: (provider: ProviderId, keyId: string) => ProviderKey | undefined
  getNextKey: (provider: ProviderId, excludeKeyIds?: string[]) => ProviderKey | null
  setRouting: (workflow: string, provider: ProviderId) => void
  getRouting: (workflow: string) => ProviderId
  fetchMaintenance: () => Promise<void>
  isProviderMaintenance: (provider: ProviderId) => boolean
  getMaintenanceMessage: (provider: ProviderId) => string
  loadFromStorage: () => void
  saveToStorage: () => void
}

const STORAGE_KEY = 'arkxmotion.providers'

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function loadKeysFromStorage(): Record<ProviderId, ProviderKey[]> {
  const defaults: Record<ProviderId, ProviderKey[]> = {
    weavy: [],
    wavespeed: [],
    magnific: [],
    roboneo: [],
    runninghub: [],
    createpulse: [],
    framia: [],
    firefly: [],
    leonardo: [],
    gemini: [],
    openai: [],
    shotstack: [],
    creatomate: [],
    galleri5: [],
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...defaults, ...parsed }
    }
  } catch {}
  return defaults
}

function loadRoutingFromStorage(): Record<string, ProviderId> {
  try {
    const stored = localStorage.getItem('arkxmotion.routing')
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {}
  return {
    motion: 'weavy',
    'narrative-video': 'weavy',
    storyboard: 'weavy',
    'bulk-fashion': 'weavy',
    'image-to-video': 'weavy',
    upscaler: 'magnific',
    'ai-influencer': 'gemini',
  }
}

export const useProviderManager = create<ProviderState>((set, get) => ({
  keys: loadKeysFromStorage(),
  activeProvider: 'weavy',
  routing: loadRoutingFromStorage(),
  maintenance: getDefaultMaintenance(),

  setActiveProvider: (provider) => {
    set({ activeProvider: provider })
    localStorage.setItem('arkxmotion.activeProvider', provider)
  },

  addKey: (provider, key, name) => {
    const newKey: ProviderKey = {
      id: generateId(),
      key,
      name: name || `Key ${get().keys[provider].length + 1}`,
      status: 'unknown',
    }
    
    // ✨ VALIDASI SAAT PENAMBAHAN: Validasi dan sesuaikan status
    if (provider === 'leonardo') {
      const isValid = isValidLeonardoJwt(newKey.key)
      newKey.status = isValid ? 'active' : 'invalid'
      
      if (!isValid) {
        console.warn(`[providerManager] Kunci Leonardo baru invalid: ${newKey.name}`)
      } else {
        console.log(`[providerManager] Kunci Leonardo baru valid: ${newKey.name}`)
      }
    }
    
    set((state) => {
      const updated = {
        ...state.keys,
        [provider]: [...state.keys[provider], newKey],
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { keys: updated }
    })
  },

  importKeys: (provider, tokenValues, namePrefix) => {
    const existingKeys = new Set(get().keys[provider].map((k) => k.key))
    const prefix = namePrefix || `${provider.charAt(0).toUpperCase() + provider.slice(1)}`
    let added = 0
    const newKeys: ProviderKey[] = []

    for (const tv of tokenValues) {
      if (!existingKeys.has(tv)) {
        newKeys.push({
          id: generateId(),
          key: tv,
          name: `${prefix} #${get().keys[provider].length + added + 1}`,
          status: 'unknown',
        })
        existingKeys.add(tv)
        added++
      }
    }

    if (added > 0) {
      set((state) => {
        const updated = {
          ...state.keys,
          [provider]: [...state.keys[provider], ...newKeys],
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return { keys: updated }
      })
    }

    return added
  },

  removeKey: (provider, keyId) => {
    set((state) => {
      const updated = {
        ...state.keys,
        [provider]: state.keys[provider].filter((k) => k.id !== keyId),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { keys: updated }
    })
  },

  updateKeyStatus: (provider, keyId, status, balance, email?) => {
    set((state) => {
      const updated = {
        ...state.keys,
        [provider]: state.keys[provider].map((k) =>
          k.id === keyId
            ? { ...k, status, balance: balance ?? k.balance, email: email ?? k.email, lastChecked: Date.now() }
            : k
        ),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { keys: updated }
    })
  },

  getActiveKey: (provider) => {
    const keys = get().keys[provider]
    return keys.find((k) => k.status === 'active') || keys[0] || null
  },

  getFirstValidKey: (provider) => {
    const keys = get().keys[provider]
    return keys.find((k) => k.status === 'active' || k.status === 'unknown') || null
  },

  findKeyById: (provider, keyId) => {
    return get().keys[provider]?.find((k) => k.id === keyId)
  },

  getNextKey: (provider, excludeKeyIds = []) => {
    const keys = get().keys[provider] || []
    const exclude = new Set(excludeKeyIds)
    return (
      keys.find((k) => !exclude.has(k.id) && (k.status === 'active' || k.status === 'unknown')) ||
      keys.find((k) => !exclude.has(k.id)) ||
      null
    )
  },

  setRouting: (workflow, provider) => {
    set((state) => {
      const updated = { ...state.routing, [workflow]: provider }
      localStorage.setItem('arkxmotion.routing', JSON.stringify(updated))
      return { routing: updated }
    })
  },

  getRouting: (workflow) => {
    return get().routing[workflow] || 'weavy'
  },

  fetchMaintenance: async () => {
    try {
      const response = await fetch('/api/admin/public/maintenance')
      if (response.ok) {
        const data = await response.json()
        const maintenance = getDefaultMaintenance()
        for (const [provider, info] of Object.entries(data.maintenance)) {
          if (provider in maintenance) {
            maintenance[provider as ProviderId] = info as MaintenanceInfo
          }
        }
        set({ maintenance })
      }
    } catch {}
  },

  isProviderMaintenance: (provider) => {
    return get().maintenance[provider]?.isMaintenance || false
  },

  getMaintenanceMessage: (provider) => {
    return get().maintenance[provider]?.message || ''
  },

  loadFromStorage: () => {
    set({
      keys: loadKeysFromStorage(),
      routing: loadRoutingFromStorage(),
    })
  },

  saveToStorage: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get().keys))
    localStorage.setItem('arkxmotion.routing', JSON.stringify(get().routing))
  },
}))