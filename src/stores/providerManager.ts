import { create } from 'zustand'

export type ProviderId = 'weavy' | 'wavespeed' | 'magnific' | 'roboneo' | 'createpulse' | 'elevenlabs' | 'gemini' | 'openai'

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
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    icon: '🎙️',
    description: 'AI voice generation and text-to-speech',
    keyPlaceholder: 'Paste your ElevenLabs API key...',
    keyFormat: 'API key',
    minCredits: 50,
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
}

interface ProviderState {
  keys: Record<ProviderId, ProviderKey[]>
  activeProvider: ProviderId
  routing: Record<string, ProviderId>

  setActiveProvider: (provider: ProviderId) => void
  addKey: (provider: ProviderId, key: string, name?: string) => void
  removeKey: (provider: ProviderId, keyId: string) => void
  updateKeyStatus: (provider: ProviderId, keyId: string, status: ProviderKey['status'], balance?: number | null) => void
  getActiveKey: (provider: ProviderId) => ProviderKey | null
  getFirstValidKey: (provider: ProviderId) => ProviderKey | null
  setRouting: (workflow: string, provider: ProviderId) => void
  getRouting: (workflow: string) => ProviderId
  loadFromStorage: () => void
  saveToStorage: () => void
}

const STORAGE_KEY = 'arkxmotion.providers'

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function loadKeysFromStorage(): Record<ProviderId, ProviderKey[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {}
  return {
    weavy: [],
    wavespeed: [],
    magnific: [],
    roboneo: [],
    createpulse: [],
    elevenlabs: [],
    gemini: [],
    openai: [],
  }
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
  }
}

export const useProviderManager = create<ProviderState>((set, get) => ({
  keys: loadKeysFromStorage(),
  activeProvider: 'weavy',
  routing: loadRoutingFromStorage(),

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
    set((state) => {
      const updated = {
        ...state.keys,
        [provider]: [...state.keys[provider], newKey],
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return { keys: updated }
    })
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

  updateKeyStatus: (provider, keyId, status, balance) => {
    set((state) => {
      const updated = {
        ...state.keys,
        [provider]: state.keys[provider].map((k) =>
          k.id === keyId
            ? { ...k, status, balance: balance ?? k.balance, lastChecked: Date.now() }
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
