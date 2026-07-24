import { create } from 'zustand'

interface ImageToVideoState {
  imgUrl: string | null
  imgFile: File | null
  provider: string
  model: string
  ratio: string
  quality: string
  tplIdx: number
  prompt: string
  results: string[]
  status: { show: boolean; text: string; pct: number; time: string }
  generating: boolean

  setImgUrl: (url: string | null) => void
  setImgFile: (file: File | null) => void
  setProvider: (provider: string) => void
  setModel: (model: string) => void
  setRatio: (ratio: string) => void
  setQuality: (quality: string) => void
  setTplIdx: (idx: number) => void
  setPrompt: (prompt: string) => void
  addResult: (url: string) => void
  removeResult: (index: number) => void
  clearResults: () => void
  setStatus: (status: Partial<ImageToVideoState['status']>) => void
  setGenerating: (generating: boolean) => void
}

export const useImageToVideoStore = create<ImageToVideoState>((set) => ({
  imgUrl: null,
  imgFile: null,
  provider: 'weavy',
  model: '',
  ratio: '9:16',
  quality: 'std',
  tplIdx: 0,
  prompt: '',
  results: [],
  status: { show: false, text: '', pct: 0, time: '0:00' },
  generating: false,

  setImgUrl: (url) => set({ imgUrl: url }),
  setImgFile: (file) => set({ imgFile: file }),
  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setRatio: (ratio) => set({ ratio }),
  setQuality: (quality) => set({ quality }),
  setTplIdx: (idx) => set({ tplIdx: idx }),
  setPrompt: (prompt) => set({ prompt }),
  addResult: (url) => set((state) => ({
    results: [url, ...state.results],
  })),
  removeResult: (index) => set((state) => ({
    results: state.results.filter((_, i) => i !== index),
  })),
  clearResults: () => set({ results: [] }),
  setStatus: (status) => set((state) => ({
    status: { ...state.status, ...status },
  })),
  setGenerating: (generating) => set({ generating }),
}))
