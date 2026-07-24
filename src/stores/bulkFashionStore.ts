import { create } from 'zustand'

export interface BulkFashionResult {
  url: string
  status: 'done' | 'error'
  error?: string
}

interface BulkFashionState {
  charUrl: string | null
  charFile: File | null
  outfitUrls: string[]
  outfitFiles: File[]
  results: BulkFashionResult[]
  productType: string
  ratio: string
  provider: string
  model: string
  quality: string
  tplIdx: number
  status: { show: boolean; text: string; pct: number; time: string }
  generating: boolean

  setCharUrl: (url: string | null) => void
  setCharFile: (file: File | null) => void
  addOutfits: (urls: string[], files: File[]) => void
  removeOutfit: (index: number) => void
  setProductType: (type: string) => void
  setRatio: (ratio: string) => void
  setProvider: (provider: string) => void
  setModel: (model: string) => void
  setQuality: (quality: string) => void
  setTplIdx: (idx: number) => void
  setStatus: (status: Partial<BulkFashionState['status']>) => void
  setGenerating: (generating: boolean) => void
  addResult: (result: BulkFashionResult) => void
  clearResults: () => void
  removeResult: (index: number) => void
}

export const useBulkFashionStore = create<BulkFashionState>((set) => ({
  charUrl: null,
  charFile: null,
  outfitUrls: [],
  outfitFiles: [],
  results: [],
  productType: 'Atasan',
  ratio: '9:16',
  provider: 'weavy',
  model: '',
  quality: 'standard',
  tplIdx: 0,
  status: { show: false, text: '', pct: 0, time: '0:00' },
  generating: false,

  setCharUrl: (url) => set({ charUrl: url }),
  setCharFile: (file) => set({ charFile: file }),
  addOutfits: (urls, files) => set((state) => ({
    outfitUrls: [...state.outfitUrls, ...urls].slice(0, 50),
    outfitFiles: [...state.outfitFiles, ...files].slice(0, 50),
  })),
  removeOutfit: (index) => set((state) => ({
    outfitUrls: state.outfitUrls.filter((_, i) => i !== index),
    outfitFiles: state.outfitFiles.filter((_, i) => i !== index),
  })),
  setProductType: (type) => set({ productType: type }),
  setRatio: (ratio) => set({ ratio }),
  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setQuality: (quality) => set({ quality }),
  setTplIdx: (idx) => set({ tplIdx: idx }),
  setStatus: (status) => set((state) => ({
    status: { ...state.status, ...status },
  })),
  setGenerating: (generating) => set({ generating }),
  addResult: (result) => set((state) => ({
    results: [...state.results, result],
  })),
  clearResults: () => set({ results: [] }),
  removeResult: (index) => set((state) => ({
    results: state.results.filter((_, i) => i !== index),
  })),
}))
