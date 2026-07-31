import { create } from 'zustand'

export interface ProviderKey {
  id: string
  name: string
  key: string
  status: 'active' | 'expired' | 'invalid'
}

export interface Provider {
  id: string
  name: string
  icon: string
  keys: ProviderKey[]
  status: 'healthy' | 'degraded' | 'down' | 'no-key'
}

interface ProviderState {
  providers: Record<string, Provider>
  activeProvider: string
  setActiveProvider: (provider: string) => void
  addKey: (providerId: string, key: Omit<ProviderKey, 'id'>) => void
  removeKey: (providerId: string, keyId: string) => void
  updateKeyStatus: (providerId: string, keyId: string, status: ProviderKey['status']) => void
}

const defaultProviders: Record<string, Provider> = {
  weavy: {
    id: 'weavy',
    name: 'Weavy',
    icon: '🌊',
    keys: [],
    status: 'no-key',
  },
  wavespeed: {
    id: 'wavespeed',
    name: 'Wavespeed',
    icon: '⚡',
    keys: [],
    status: 'no-key',
  },
  roboneo: {
    id: 'roboneo',
    name: 'Roboneo',
    icon: '🤖',
    keys: [],
    status: 'no-key',
  },
}

export const useProviderStore = create<ProviderState>((set) => ({
  providers: defaultProviders,
  activeProvider: 'weavy',
  setActiveProvider: (provider) => set({ activeProvider: provider }),
  addKey: (providerId, key) =>
    set((state) => ({
      providers: {
        ...state.providers,
        [providerId]: {
          ...state.providers[providerId],
          keys: [...state.providers[providerId].keys, { ...key, id: Date.now().toString() }],
          status: 'healthy',
        },
      },
    })),
  removeKey: (providerId, keyId) =>
    set((state) => ({
      providers: {
        ...state.providers,
        [providerId]: {
          ...state.providers[providerId],
          keys: state.providers[providerId].keys.filter((k) => k.id !== keyId),
          status:
            state.providers[providerId].keys.length <= 1 ? 'no-key' : state.providers[providerId].status,
        },
      },
    })),
  updateKeyStatus: (providerId, keyId, status) =>
    set((state) => ({
      providers: {
        ...state.providers,
        [providerId]: {
          ...state.providers[providerId],
          keys: state.providers[providerId].keys.map((k) =>
            k.id === keyId ? { ...k, status } : k
          ),
        },
      },
    })),
}))
