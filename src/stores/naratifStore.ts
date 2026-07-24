import { create } from 'zustand'

export interface NaratifScene {
  idx: number
  prompt: string
  videoPrompt: string
  narration: string
  imgUrl?: string
  audioUrl?: string
  videoUrl?: string
  busy?: 'img' | 'vo' | 'vid' | null
}

export interface NaratifMaterial {
  title: string
  desc: string
  body: string
  hero?: string
  images?: string[]
}

interface NaratifState {
  url: string
  scraping: boolean
  scrapeStatus: string
  material: NaratifMaterial | null
  provider: string
  imgProvider: string
  ratio: string
  imgModel: string
  imgQuality: string
  vidModel: string
  vidQuality: string
  voice: string
  voicePreset: string
  extra: string
  sceneGap: number
  xfadeDur: number
  leadOutDur: number
  brainStatus: string
  scenes: NaratifScene[]
  mergeStatus: string
  finalUrl: string | null
  generating: { img: boolean; vo: boolean; vid: boolean; merge: boolean }

  setUrl: (url: string) => void
  setScraping: (scraping: boolean) => void
  setScrapeStatus: (status: string) => void
  setMaterial: (material: NaratifMaterial | null) => void
  setProvider: (provider: string) => void
  setImgProvider: (provider: string) => void
  setRatio: (ratio: string) => void
  setImgModel: (model: string) => void
  setImgQuality: (quality: string) => void
  setVidModel: (model: string) => void
  setVidQuality: (quality: string) => void
  setVoice: (voice: string) => void
  setVoicePreset: (preset: string) => void
  setExtra: (extra: string) => void
  setSceneGap: (gap: number) => void
  setXfadeDur: (dur: number) => void
  setLeadOutDur: (dur: number) => void
  setBrainStatus: (status: string) => void
  setScenes: (scenes: NaratifScene[]) => void
  updateScene: (index: number, updates: Partial<NaratifScene>) => void
  setMergeStatus: (status: string) => void
  setFinalUrl: (url: string | null) => void
  setGenerating: (updates: Partial<{ img: boolean; vo: boolean; vid: boolean; merge: boolean }>) => void
}

export const useNaratifStore = create<NaratifState>((set) => ({
  url: '',
  scraping: false,
  scrapeStatus: '',
  material: null,
  provider: 'weavy',
  imgProvider: 'weavy',
  ratio: '9:16',
  imgModel: '',
  imgQuality: '',
  vidModel: '',
  vidQuality: '',
  voice: '',
  voicePreset: 'story',
  extra: '',
  sceneGap: 0.7,
  xfadeDur: 0.5,
  leadOutDur: 0.4,
  brainStatus: '',
  scenes: [],
  mergeStatus: '',
  finalUrl: null,
  generating: { img: false, vo: false, vid: false, merge: false },

  setUrl: (url) => set({ url }),
  setScraping: (scraping) => set({ scraping }),
  setScrapeStatus: (status) => set({ scrapeStatus: status }),
  setMaterial: (material) => set({ material }),
  setProvider: (provider) => set({ provider }),
  setImgProvider: (provider) => set({ imgProvider: provider }),
  setRatio: (ratio) => set({ ratio }),
  setImgModel: (model) => set({ imgModel: model }),
  setImgQuality: (quality) => set({ imgQuality: quality }),
  setVidModel: (model) => set({ vidModel: model }),
  setVidQuality: (quality) => set({ vidQuality: quality }),
  setVoice: (voice) => set({ voice }),
  setVoicePreset: (preset) => set({ voicePreset: preset }),
  setExtra: (extra) => set({ extra }),
  setSceneGap: (gap) => set({ sceneGap: gap }),
  setXfadeDur: (dur) => set({ xfadeDur: dur }),
  setLeadOutDur: (dur) => set({ leadOutDur: dur }),
  setBrainStatus: (status) => set({ brainStatus: status }),
  setScenes: (scenes) => set({ scenes }),
  updateScene: (index, updates) => set((state) => ({
    scenes: state.scenes.map((s, i) => (i === index ? { ...s, ...updates } : s)),
  })),
  setMergeStatus: (status) => set({ mergeStatus: status }),
  setFinalUrl: (url) => set({ finalUrl: url }),
  setGenerating: (updates) => set((state) => ({
    generating: { ...state.generating, ...updates },
  })),
}))
