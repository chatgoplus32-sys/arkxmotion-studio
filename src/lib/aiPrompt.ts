export interface PromptStyle {
  id: string
  name: string
  icon: string
  keywords: string[]
  template: string
  camera: string[]
  lighting: string[]
  mood: string[]
}

export const STYLES: PromptStyle[] = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    icon: '🎬',
    keywords: ['film', 'movie', 'cinema', 'hollywood', 'dramatic'],
    template: 'Cinematic shot, {subject}, {camera}, {lighting}, {mood}, film grain, anamorphic lens flare, shallow depth of field, 24fps',
    camera: ['Slow dolly push in', 'Low angle tracking shot', 'Wide establishing shot', 'Dutch angle', 'Steadicam following shot'],
    lighting: ['Golden hour backlight', 'Dramatic side lighting', 'Soft diffused natural light', 'Neon rim lighting', 'Chiaroscuro contrast'],
    mood: ['Epic and emotional', 'Tense and suspenseful', 'Romantic and intimate', 'Mysterious and haunting', 'Uplifting and triumphant'],
  },
  {
    id: 'anime',
    name: 'Anime',
    icon: '🌸',
    keywords: ['anime', 'manga', 'japanese', 'ghibli', 'jujutsu'],
    template: 'Anime style, {subject}, {camera}, {lighting}, {mood}, Studio Ghibli inspired, cel shading, vibrant colors, detailed background',
    camera: ['Dynamic action pan', 'Soft zoom into face', 'Wide landscape reveal', 'Tilt up to sky', 'Parallax depth movement'],
    lighting: ['Soft pastel sunset', 'Cherry blossom filtered light', 'Dramatic moonlight', 'Warm afternoon glow', 'Ethereal backlight'],
    mood: ['Peaceful and serene', 'Energetic and exciting', 'Melancholic and nostalgic', 'Whimsical and magical', 'Determined and fierce'],
  },
  {
    id: 'realistic',
    name: 'Photorealistic',
    icon: '📸',
    keywords: ['real', 'photo', 'natural', 'documentary', 'realistic'],
    template: 'Photorealistic, {subject}, {camera}, {lighting}, {mood}, shot on ARRI Alexa, 8K, natural skin tones, documentary style',
    camera: ['Handheld natural movement', 'Static tripod shot', 'Slow pan across scene', 'Over the shoulder', 'Aerial drone descent'],
    lighting: ['Natural window light', 'Overcast soft light', 'Harsh midday sun', 'Practical interior lighting', 'Blue hour twilight'],
    mood: ['Authentic and raw', 'Contemplative', 'Joyful and candid', 'Gritty and intense', 'Warm and inviting'],
  },
  {
    id: 'horror',
    name: 'Horror',
    icon: '👻',
    keywords: ['horror', 'scary', 'creepy', 'dark', 'haunted'],
    template: 'Horror atmosphere, {subject}, {camera}, {lighting}, {mood}, fog, desaturated, unsettling, dread, slow reveal',
    camera: ['Slow creeping zoom', 'POV stalking shot', 'Dutch angle tilt', 'Whip pan to empty space', 'Steady tracking through dark corridor'],
    lighting: ['Flickering single bulb', 'Deep shadows with single light source', 'Cold blue moonlight', 'Backlit silhouette', 'Strobe flash effect'],
    mood: ['Deeply unsettling', 'Creeping dread', 'Jump scare tension', 'Psychological terror', 'Isolation and vulnerability'],
  },
  {
    id: 'scifi',
    name: 'Sci-Fi',
    icon: '🚀',
    keywords: ['sci-fi', 'future', 'cyber', 'neon', 'space', 'robot'],
    template: 'Sci-fi atmosphere, {subject}, {camera}, {lighting}, {mood}, cyberpunk, neon lights, holographic elements, futuristic technology',
    camera: ['Sweeping crane shot', 'Through holographic display', 'Vertical tilt up skyscraper', 'Orbital rotation', 'Zero-gravity drift'],
    lighting: ['Neon cyan and magenta', 'Cold blue ambient', 'Holographic reflections', 'Pulsing LED arrays', 'Stark clinical white'],
    mood: ['High-tech wonder', 'Dystopian tension', 'Neural overload', 'Cold precision', 'Electric anticipation'],
  },
  {
    id: 'nature',
    name: 'Nature',
    icon: '🌿',
    keywords: ['nature', 'forest', 'ocean', 'mountain', 'wildlife', 'animal'],
    template: 'Nature documentary, {subject}, {camera}, {lighting}, {mood}, 4K wildlife cinematography, National Geographic style',
    camera: ['Slow majestic pan', 'Macro close-up reveal', 'Aerial establishing shot', 'Low angle ground level', 'Fluid tracking shot'],
    lighting: ['Golden hour warmth', 'Dappled forest light', 'Dramatic cloud breaks', 'Misty morning diffusion', 'Twilight blue'],
    mood: ['Majestic and awe-inspiring', 'Peaceful meditation', 'Wild and untamed', 'Delicate beauty', 'Raw power of nature'],
  },
  {
    id: 'music',
    name: 'Music Video',
    icon: '🎵',
    keywords: ['music', 'concert', 'dance', 'stage', 'performance'],
    template: 'Music video style, {subject}, {camera}, {lighting}, {mood}, performance energy, rhythmic editing, concert atmosphere',
    camera: ['Dynamic orbit around subject', 'Crash zoom in', 'Smooth gimbal follow', 'Whip pan transition', 'Overhead bird eye'],
    lighting: ['Colorful stage lights', 'Strobe and laser effects', 'Backlit performer silhouette', 'Spotlight isolation', 'RGB LED wash'],
    mood: ['Electric energy', 'Raw emotion', 'Confident power', 'Dreamy ethereal', 'Hype and excitement'],
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    icon: '✨',
    keywords: ['fantasy', 'magic', 'dragon', 'fairy', 'medieval', 'lord of the rings'],
    template: 'Fantasy epic, {subject}, {camera}, {lighting}, {mood}, magical particles, ethereal atmosphere, Lord of the Rings inspired',
    camera: ['Majestic wide reveal', 'Hero tracking shot', 'Tilt up to reveal scale', 'Sweeping landscape pan', 'Close-up with bokeh particles'],
    lighting: ['Ethereal golden glow', 'Magical particle light', 'Dramatic god rays', 'Moonlit silver', 'Firelight warmth'],
    mood: ['Epic adventure', 'Ancient wonder', 'Dark foreboding', 'Magical discovery', 'Heroic determination'],
  },
]

export interface GeneratedPrompt {
  text: string
  style: string
  camera: string
  lighting: string
  mood: string
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generatePrompt(idea: string, styleId?: string): GeneratedPrompt {
  const style = styleId ? STYLES.find((s) => s.id === styleId) : pickRandom(STYLES.filter((s) => s.keywords.some((k) => idea.toLowerCase().includes(k)))) || pickRandom(STYLES)

  const camera = pickRandom(style.camera)
  const lighting = pickRandom(style.lighting)
  const mood = pickRandom(style.mood)

  const text = style.template
    .replace('{subject}', idea || 'a person standing in a beautiful environment')
    .replace('{camera}', camera)
    .replace('{lighting}', lighting)
    .replace('{mood}', mood)

  return { text, style: style.name, camera, lighting, mood }
}

export function generateVariations(idea: string, count: number = 3): GeneratedPrompt[] {
  const results: GeneratedPrompt[] = []
  const usedCombos = new Set<string>()

  while (results.length < count && results.length < STYLES.length) {
    const prompt = generatePrompt(idea)
    const key = `${prompt.style}|${prompt.camera}|${prompt.lighting}`
    if (!usedCombos.has(key)) {
      usedCombos.add(key)
      results.push(prompt)
    }
  }
  return results
}
