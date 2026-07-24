import { create } from 'zustand'

export interface MotionSlot {
  id: string
  image: File | null
  imageUrl: string | null
  video: File | null
  videoUrl: string | null
  status: 'idle' | 'uploading' | 'processing' | 'done' | 'error'
  statusText?: string
  resultUrl?: string
  error?: string
}

export interface MotionResult {
  id: string
  url: string
  provider: string
  modelKey: string
  prompt?: string
  date: string
}

interface MotionState {
  provider: string
  modelKey: string
  orientation: 'video' | 'image'
  prompt: string
  negativePrompt: string
  keepSound: boolean
  slots: MotionSlot[]
  generating: boolean
  logs: Array<{ time: string; msg: string; level: string }>
  results: MotionResult[]

  setProvider: (provider: string) => void
  setModelKey: (key: string) => void
  setOrientation: (orientation: 'video' | 'image') => void
  setPrompt: (prompt: string) => void
  setNegativePrompt: (prompt: string) => void
  setKeepSound: (keep: boolean) => void
  addSlot: () => void
  removeSlot: (id: string) => void
  updateSlot: (id: string, updates: Partial<MotionSlot>) => void
  setGenerating: (generating: boolean) => void
  addLog: (msg: string, level?: string) => void
  clearLogs: () => void
  addResult: (result: MotionResult) => void
  removeResult: (id: string) => void
  clearResults: () => void
}

const createSlot = (): MotionSlot => ({
  id: Math.random().toString(36).slice(2),
  image: null,
  imageUrl: null,
  video: null,
  videoUrl: null,
  status: 'idle',
})

export const useMotionStore = create<MotionState>((set) => ({
  provider: 'weavy',
  modelKey: '',
  orientation: 'video',
  prompt: '',
  negativePrompt: '',
  keepSound: true,
  slots: [createSlot()],
  generating: false,
  logs: [],
  results: [],

  setProvider: (provider) => set({ provider }),
  setModelKey: (key) => set({ modelKey: key }),
  setOrientation: (orientation) => set({ orientation }),
  setPrompt: (prompt) => set({ prompt }),
  setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),
  setKeepSound: (keep) => set({ keepSound: keep }),
  addSlot: () => set((state) => ({
    slots: [...state.slots, createSlot()],
  })),
  removeSlot: (id) => set((state) => ({
    slots: state.slots.length > 1 ? state.slots.filter((s) => s.id !== id) : state.slots,
  })),
  updateSlot: (id, updates) => set((state) => ({
    slots: state.slots.map((s) => (s.id === id ? { ...s, ...updates } : s)),
  })),
  setGenerating: (generating) => set({ generating }),
  addLog: (msg, level = 'info') => set((state) => ({
    logs: [...state.logs, { time: new Date().toLocaleTimeString(), msg, level }].slice(-200),
  })),
  clearLogs: () => set({ logs: [] }),
  addResult: (result) => set((state) => ({
    results: [result, ...state.results],
  })),
  removeResult: (id) => set((state) => ({
    results: state.results.filter((r) => r.id !== id),
  })),
  clearResults: () => set({ results: [] }),
}))
