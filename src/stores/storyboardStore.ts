import { create } from 'zustand'

export interface StoryboardRow {
  rowId: string
  url: string
  info: any | null
  selectedImages: string[]
  status: 'idle' | 'loading' | 'ok' | 'err'
  error: string
}

export interface StoryboardResult {
  resultId: string
  rowId: string
  title: string
  status: 'pending' | 'brain' | 'image' | 'done' | 'err'
  prompt?: string
  imgUrl?: string
  error?: string
  ratio?: string
}

interface StoryboardState {
  provider: string
  modelKey: string
  qualityV: string
  sceneCount: string
  ratio: string
  framing: string
  ctaTarget: string
  ctaCustom: string
  prompt: string
  rows: StoryboardRow[]
  results: StoryboardResult[]
  logs: string[]
  busy: boolean

  setProvider: (provider: string) => void
  setModelKey: (key: string) => void
  setQualityV: (quality: string) => void
  setSceneCount: (count: string) => void
  setRatio: (ratio: string) => void
  setFraming: (framing: string) => void
  setCtaTarget: (target: string) => void
  setCtaCustom: (custom: string) => void
  setPrompt: (prompt: string) => void
  addRow: () => void
  removeRow: (rowId: string) => void
  updateRow: (rowId: string, updates: Partial<StoryboardRow>) => void
  toggleImage: (rowId: string, imageUrl: string) => void
  setResults: (results: StoryboardResult[] | ((prev: StoryboardResult[]) => StoryboardResult[])) => void
  updateResult: (resultId: string, updates: Partial<StoryboardResult>) => void
  addLog: (msg: string) => void
  clearAll: () => void
  setBusy: (busy: boolean) => void
}

const createRow = (): StoryboardRow => ({
  rowId: 'r' + Math.random().toString(36).slice(2, 8),
  url: '',
  info: null,
  selectedImages: [],
  status: 'idle',
  error: '',
})

export const useStoryboardStore = create<StoryboardState>((set) => ({
  provider: 'weavy',
  modelKey: '',
  qualityV: '',
  sceneCount: '6',
  ratio: '9:16',
  framing: 'normal',
  ctaTarget: 'tiktok',
  ctaCustom: '',
  prompt: '',
  rows: [createRow()],
  results: [],
  logs: [],
  busy: false,

  setProvider: (provider) => set({ provider }),
  setModelKey: (key) => set({ modelKey: key }),
  setQualityV: (quality) => set({ qualityV: quality }),
  setSceneCount: (count) => set({ sceneCount: count }),
  setRatio: (ratio) => set({ ratio }),
  setFraming: (framing) => set({ framing }),
  setCtaTarget: (target) => set({ ctaTarget: target }),
  setCtaCustom: (custom) => set({ ctaCustom: custom }),
  setPrompt: (prompt) => set({ prompt }),
  addRow: () => set((state) => ({ rows: [...state.rows, createRow()] })),
  removeRow: (rowId) => set((state) => ({
    rows: state.rows.length > 1 ? state.rows.filter((r) => r.rowId !== rowId) : state.rows,
  })),
  updateRow: (rowId, updates) => set((state) => ({
    rows: state.rows.map((r) => (r.rowId === rowId ? { ...r, ...updates } : r)),
  })),
  toggleImage: (rowId, imageUrl) => set((state) => ({
    rows: state.rows.map((r) => {
      if (r.rowId !== rowId) return r
      const selected = r.selectedImages.includes(imageUrl)
        ? r.selectedImages.filter((i) => i !== imageUrl)
        : r.selectedImages.length < 6
        ? [...r.selectedImages, imageUrl]
        : r.selectedImages
      return { ...r, selectedImages: selected }
    }),
  })),
  setResults: (results) => set((state) => ({
    results: typeof results === 'function' ? results(state.results) : results,
  })),
  updateResult: (resultId, updates) => set((state) => ({
    results: state.results.map((r) => (r.resultId === resultId ? { ...r, ...updates } : r)),
  })),
  addLog: (msg) => set((state) => ({
    logs: [`[${new Date().toLocaleTimeString()}] ${msg}`, ...state.logs].slice(0, 200),
  })),
  clearAll: () => set({ results: [], logs: [] }),
  setBusy: (busy) => set({ busy }),
}))
