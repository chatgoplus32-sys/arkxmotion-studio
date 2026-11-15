import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp01, theme } from './theme';

export type ExplainerProps = {
  script: string;
  styleId: string;
  format: 'vertical' | 'horizontal' | 'square';
  narrationSrc: string;
  volume: number;
};

type ScenePlan = {
  index: number;
  sentence: string;
  title: string;
  focus: string[];
  label: string;
  visual: string;
  words: string[];
  durationInFrames: number;
};

type ArtStyle = {
  name: string;
  bg: string;
  mid: string;
  accent: string;
  second: string;
  ink: string;
  muted: string;
  font: string;
  pattern: string;
};

export const ART_STYLES: Record<string, ArtStyle> = {
  cinema: { name: 'Cinematic', bg: '#080b14', mid: '#171624', accent: '#ffb778', second: '#ff643f', ink: '#f8f4f1', muted: '#bcb8c4', font: 'Inter', pattern: 'cinematic-glow' },
  editorial: { name: 'Editorial', bg: '#f1eadc', mid: '#dbcfbb', accent: '#ba4c30', second: '#192b38', ink: '#211b18', muted: '#686054', font: 'Georgia', pattern: 'editorial-rules' },
  neon: { name: 'Neon cyber', bg: '#061410', mid: '#0b2823', accent: '#53f4bd', second: '#47a9ff', ink: '#eafff7', muted: '#8bafa3', font: 'Arial', pattern: 'neon-perspective' },
  blueprint: { name: 'Blueprint', bg: '#071a31', mid: '#0c2b4d', accent: '#82d4ff', second: '#fff1a6', ink: '#eff8ff', muted: '#a2c4dd', font: 'monospace', pattern: 'blueprint-grid' },
  paper: { name: 'Cut-paper', bg: '#271e18', mid: '#3c2b20', accent: '#ffc27f', second: '#f26a4d', ink: '#fff3dd', muted: '#d5c0a0', font: 'Arial', pattern: 'cut-paper-layers' },
  retro: { name: 'Retro grain', bg: '#1a0e26', mid: '#3a1640', accent: '#ffcf5b', second: '#f56b8b', ink: '#fff2da', muted: '#d6b7c5', font: 'Impact', pattern: 'retro-scanlines' },
  minimal: { name: 'Minimal', bg: '#101217', mid: '#1b1e25', accent: '#d9e2f1', second: '#96a6c8', ink: '#f7f8fb', muted: '#9ba3b4', font: 'Arial', pattern: 'minimal-lines' },
  pop: { name: 'Pop collage', bg: '#17122b', mid: '#2d1b43', accent: '#ffdd37', second: '#ff5c85', ink: '#fffbea', muted: '#c8bdd5', font: 'Arial Black', pattern: 'pop-halftone' },
  data: { name: 'Data lab', bg: '#101d23', mid: '#18313a', accent: '#a6e56e', second: '#54d1dc', ink: '#edfcfa', muted: '#9eb9b8', font: 'monospace', pattern: 'data-matrix' },
  botanical: { name: 'Botanical', bg: '#102017', mid: '#1e3829', accent: '#d0dd8c', second: '#f3aa71', ink: '#f5f3df', muted: '#afc0a4', font: 'Georgia', pattern: 'botanical-leaves' },
  luxe: { name: 'Luxe gold', bg: '#11100e', mid: '#292219', accent: '#e7c47c', second: '#fff0c3', ink: '#fffaf0', muted: '#c1b8a6', font: 'Georgia', pattern: 'art-deco-fan' },
  playful: { name: 'Playful', bg: '#172338', mid: '#243457', accent: '#a8edff', second: '#ffa8d6', ink: '#f8fbff', muted: '#b9c9df', font: 'Arial', pattern: 'playful-bubbles' },
  swiss: { name: 'Swiss modern', bg: '#f3f0e8', mid: '#e4dccb', accent: '#e63d2e', second: '#181818', ink: '#171717', muted: '#5d5d5d', font: 'Inter', pattern: 'swiss-grid' },
  vaporwave: { name: 'Vaporwave', bg: '#170e3d', mid: '#481d72', accent: '#ff77c8', second: '#55dcff', ink: '#fff3ff', muted: '#cba8de', font: 'Impact', pattern: 'vaporwave-sunset' },
  holographic: { name: 'Holographic', bg: '#101321', mid: '#242d49', accent: '#a5f3ff', second: '#ff91cb', ink: '#f6ffff', muted: '#b2bfd3', font: 'Arial', pattern: 'holographic-rings' },
  ink: { name: 'Hand-drawn ink', bg: '#fbf1dc', mid: '#edddb6', accent: '#df613d', second: '#365c50', ink: '#28221a', muted: '#685f51', font: 'Arial', pattern: 'handdrawn-ink' },
  cyberpunk: { name: 'Cyberpunk noir', bg: '#17001d', mid: '#3a032a', accent: '#ff3be6', second: '#47f2ed', ink: '#fff4fd', muted: '#d7a7cd', font: 'Arial', pattern: 'cyberpunk-glitch' },
  brutalist: { name: 'Brutalist type', bg: '#e7e5db', mid: '#c7c1b6', accent: '#fe482f', second: '#121212', ink: '#101010', muted: '#55514a', font: 'Impact', pattern: 'brutalist-blocks' },
  glass: { name: 'Glassmorphism', bg: '#101c36', mid: '#21365e', accent: '#9ce3ff', second: '#d7a3ff', ink: '#f4f9ff', muted: '#b5c4da', font: 'Arial', pattern: 'glass-panels' },
  isometric: { name: 'Isometric', bg: '#12243a', mid: '#234360', accent: '#ffbe62', second: '#67e0c2', ink: '#eff8ff', muted: '#aac2d2', font: 'Arial', pattern: 'isometric-grid' },
  chalk: { name: 'Chalkboard', bg: '#082a25', mid: '#113d34', accent: '#ffefb1', second: '#8de1b8', ink: '#f4f4de', muted: '#b8c9b4', font: 'Arial', pattern: 'chalkboard' },
  thermal: { name: 'Thermal map', bg: '#170b2e', mid: '#4a125c', accent: '#ffef4d', second: '#ff4d5c', ink: '#fff7e7', muted: '#d2b2dc', font: 'Arial', pattern: 'thermal-contours' },
  mosaic: { name: 'Mosaic tiles', bg: '#182023', mid: '#30454a', accent: '#72e0d1', second: '#ffb45e', ink: '#eff8f4', muted: '#a9bbb9', font: 'Arial', pattern: 'mosaic-tiles' },
  clay: { name: 'Clay craft', bg: '#2c1627', mid: '#512b3f', accent: '#ffa992', second: '#ffd36a', ink: '#fff4ed', muted: '#d9b9b1', font: 'Arial', pattern: 'clay-forms' },
  mono: { name: 'Monochrome', bg: '#080a0c', mid: '#202326', accent: '#f2f1ea', second: '#7b8088', ink: '#f9f8f2', muted: '#a7a9ab', font: 'Arial', pattern: 'monochrome-stripes' },
  bauhaus: { name: 'Bauhaus', bg: '#fff3d5', mid: '#f1dba8', accent: '#dd302f', second: '#15598d', ink: '#171717', muted: '#545049', font: 'Arial Black', pattern: 'bauhaus-geometry' },
  liquid: { name: 'Liquid chrome', bg: '#0a1623', mid: '#172c4a', accent: '#6cfff0', second: '#a68cff', ink: '#f5fffe', muted: '#a7c4d4', font: 'Arial', pattern: 'liquid-waves' },
  sports: { name: 'Sports broadcast', bg: '#071a1b', mid: '#0f4a3f', accent: '#baff33', second: '#efffda', ink: '#f2ffe9', muted: '#a6c4b2', font: 'Impact', pattern: 'sports-field' },
  science: { name: 'Science schematic', bg: '#08192b', mid: '#12324a', accent: '#82e7ff', second: '#b9f28f', ink: '#edfaff', muted: '#a6c7d7', font: 'monospace', pattern: 'science-network' },
  comic: { name: 'Comic halftone', bg: '#fae28c', mid: '#f7b856', accent: '#e84132', second: '#1d2558', ink: '#171717', muted: '#4e4941', font: 'Arial Black', pattern: 'comic-panels' },
  glitch: { name: 'Digital glitch', bg: '#100d25', mid: '#241b49', accent: '#f84d9a', second: '#3df5d7', ink: '#f3f7ff', muted: '#afafd0', font: 'Arial', pattern: 'digital-glitch' },
};

export const STYLE_OPTIONS = Object.entries(ART_STYLES).map(([id, style]) => ({ id, name: style.name }));

type ArtDirection = { layout: 'left' | 'right' | 'center' | 'split' | 'top' | 'poster' | 'frame'; motion: 'rise' | 'slide' | 'zoom' | 'orbit' | 'pulse' | 'wipe' | 'float'; align: 'left' | 'center' | 'right'; titleWeight: number; titleTracking: string; captionShape: number; visualScale: number };
const DIRECTIONS: ArtDirection[] = [
  {layout:'center',motion:'zoom',align:'left',titleWeight:800,titleTracking:'-.045em',captionShape:20,visualScale:1}, {layout:'left',motion:'rise',align:'left',titleWeight:500,titleTracking:'-.025em',captionShape:0,visualScale:.88},
  {layout:'right',motion:'slide',align:'right',titleWeight:900,titleTracking:'-.06em',captionShape:4,visualScale:.92}, {layout:'split',motion:'wipe',align:'left',titleWeight:800,titleTracking:'.01em',captionShape:2,visualScale:.78},
  {layout:'poster',motion:'rise',align:'center',titleWeight:900,titleTracking:'-.055em',captionShape:0,visualScale:1.12}, {layout:'top',motion:'pulse',align:'center',titleWeight:900,titleTracking:'.025em',captionShape:3,visualScale:.9},
  {layout:'frame',motion:'float',align:'left',titleWeight:300,titleTracking:'.08em',captionShape:0,visualScale:.86}, {layout:'poster',motion:'slide',align:'center',titleWeight:950,titleTracking:'-.075em',captionShape:12,visualScale:1.08},
  {layout:'split',motion:'rise',align:'left',titleWeight:700,titleTracking:'-.03em',captionShape:3,visualScale:.82}, {layout:'right',motion:'float',align:'left',titleWeight:500,titleTracking:'.01em',captionShape:24,visualScale:.95},
  {layout:'center',motion:'orbit',align:'center',titleWeight:500,titleTracking:'.04em',captionShape:2,visualScale:1.05}, {layout:'center',motion:'pulse',align:'center',titleWeight:700,titleTracking:'-.02em',captionShape:30,visualScale:.93},
  {layout:'left',motion:'wipe',align:'left',titleWeight:900,titleTracking:'-.06em',captionShape:0,visualScale:.84}, {layout:'poster',motion:'rise',align:'center',titleWeight:900,titleTracking:'.04em',captionShape:0,visualScale:1.14},
  {layout:'right',motion:'orbit',align:'right',titleWeight:600,titleTracking:'.02em',captionShape:28,visualScale:.9}, {layout:'frame',motion:'slide',align:'left',titleWeight:400,titleTracking:'-.015em',captionShape:2,visualScale:.88},
  {layout:'split',motion:'wipe',align:'right',titleWeight:900,titleTracking:'-.07em',captionShape:0,visualScale:.82}, {layout:'poster',motion:'pulse',align:'left',titleWeight:950,titleTracking:'-.08em',captionShape:0,visualScale:1.08},
  {layout:'center',motion:'float',align:'center',titleWeight:500,titleTracking:'-.02em',captionShape:22,visualScale:.96}, {layout:'right',motion:'rise',align:'left',titleWeight:700,titleTracking:'-.035em',captionShape:16,visualScale:.92},
  {layout:'left',motion:'slide',align:'left',titleWeight:500,titleTracking:'.015em',captionShape:2,visualScale:.85}, {layout:'split',motion:'orbit',align:'center',titleWeight:700,titleTracking:'-.025em',captionShape:4,visualScale:.82},
  {layout:'center',motion:'pulse',align:'center',titleWeight:800,titleTracking:'.015em',captionShape:20,visualScale:1.04}, {layout:'poster',motion:'float',align:'center',titleWeight:800,titleTracking:'-.04em',captionShape:18,visualScale:1.1},
  {layout:'frame',motion:'rise',align:'center',titleWeight:700,titleTracking:'-.025em',captionShape:18,visualScale:.9}, {layout:'left',motion:'wipe',align:'left',titleWeight:850,titleTracking:'-.05em',captionShape:0,visualScale:.86},
  {layout:'right',motion:'float',align:'right',titleWeight:700,titleTracking:'.02em',captionShape:18,visualScale:.96}, {layout:'split',motion:'slide',align:'left',titleWeight:900,titleTracking:'-.05em',captionShape:2,visualScale:.8},
  {layout:'center',motion:'orbit',align:'center',titleWeight:700,titleTracking:'-.02em',captionShape:16,visualScale:1.02}, {layout:'poster',motion:'wipe',align:'left',titleWeight:950,titleTracking:'-.07em',captionShape:0,visualScale:1.1},
  {layout:'frame',motion:'pulse',align:'center',titleWeight:800,titleTracking:'-.04em',captionShape:4,visualScale:.9},
];
const directionFor = (id: string): ArtDirection => DIRECTIONS[Math.max(0, Object.keys(ART_STYLES).indexOf(id))] || DIRECTIONS[0];

const textureFor = (style: ArtStyle, width: number): { image: string; size: string } => {
  const a = `${style.accent}36`;
  const b = `${style.second}30`;
  const images: Record<string, string> = {
    'cinematic-glow': `radial-gradient(ellipse at 77% 23%,${b},transparent 42%),radial-gradient(ellipse at 18% 85%,${a},transparent 46%)`,
    'editorial-rules': `repeating-linear-gradient(0deg,transparent 0 46px,${a} 47px 48px)`,
    'neon-perspective': `repeating-linear-gradient(0deg,transparent 0 36px,${a} 37px 38px),repeating-linear-gradient(90deg,transparent 0 38px,${b} 39px 40px)`,
    'blueprint-grid': `linear-gradient(${a} 1px,transparent 1px),linear-gradient(90deg,${a} 1px,transparent 1px),linear-gradient(${b} 1px,transparent 1px),linear-gradient(90deg,${b} 1px,transparent 1px)`,
    'cut-paper-layers': `radial-gradient(ellipse at 78% 28%,${a} 0 17%,transparent 18%),linear-gradient(125deg,transparent 45%,${b} 46% 63%,transparent 64%)`,
    'retro-scanlines': `repeating-linear-gradient(0deg,transparent 0 7px,${a} 8px 10px),radial-gradient(ellipse at 72% 28%,${b},transparent 42%)`,
    'minimal-lines': `linear-gradient(135deg,transparent 49.7%,${a} 50%,transparent 50.3%),linear-gradient(45deg,transparent 49.8%,${b} 50%,transparent 50.2%)`,
    'pop-halftone': `radial-gradient(circle,${a} 0 2px,transparent 2.8px)`,
    'data-matrix': `repeating-linear-gradient(90deg,${a} 0 2px,transparent 3px 28px),linear-gradient(0deg,transparent,${b})`,
    'botanical-leaves': `repeating-radial-gradient(ellipse at 85% 60%,transparent 0 24px,${a} 25px 26px,transparent 27px 52px)`,
    'art-deco-fan': `repeating-conic-gradient(from 225deg at 50% 48%,transparent 0 8deg,${a} 8.5deg 9deg,transparent 9.5deg 17deg)`,
    'playful-bubbles': `radial-gradient(circle at 22% 28%,${a} 0 18px,transparent 19px),radial-gradient(circle at 76% 68%,${b} 0 30px,transparent 31px)`,
    'swiss-grid': `linear-gradient(90deg,${b} 1px,transparent 1px),linear-gradient(0deg,transparent 0 69%,${a} 70% 87%,transparent 88%)`,
    'vaporwave-sunset': `repeating-linear-gradient(0deg,transparent 0 25px,${a} 26px 28px),radial-gradient(ellipse at 50% 37%,${b},transparent 43%)`,
    'holographic-rings': `conic-gradient(from 35deg at 72% 36%,${a},transparent,${b},transparent,${a}),radial-gradient(ellipse at 72% 36%,transparent 20%,${a} 21%,transparent 22%)`,
    'handdrawn-ink': `repeating-linear-gradient(168deg,transparent 0 30px,${a} 31px 32px,transparent 33px 54px)`,
    'cyberpunk-glitch': `repeating-linear-gradient(0deg,transparent 0 12px,${a} 13px 15px),repeating-linear-gradient(90deg,transparent 0 76px,${b} 77px 79px)`,
    'brutalist-blocks': `linear-gradient(90deg,${b} 0 19%,transparent 19% 67%,${a} 68% 92%,transparent 93%),linear-gradient(0deg,transparent 0 69%,${b} 70% 86%,transparent 87%)`,
    'glass-panels': `radial-gradient(ellipse at 22% 28%,${a},transparent 29%),radial-gradient(ellipse at 77% 70%,${b},transparent 32%)`,
    'isometric-grid': `repeating-linear-gradient(60deg,transparent 0 38px,${a} 39px 40px),repeating-linear-gradient(120deg,transparent 0 38px,${b} 39px 40px)`,
    'chalkboard': `radial-gradient(circle,${a} 0 1px,transparent 1.8px),repeating-linear-gradient(0deg,transparent 0 58px,${b} 59px 60px)`,
    'thermal-contours': `radial-gradient(ellipse at 74% 30%,${a},${b} 22%,transparent 47%),radial-gradient(ellipse at 22% 78%,${b},transparent 38%)`,
    'mosaic-tiles': `repeating-conic-gradient(${a} 0 25%,transparent 0 50%),linear-gradient(135deg,${b},transparent)`,
    'clay-forms': `radial-gradient(ellipse at 20% 70%,${a},transparent 22%),radial-gradient(ellipse at 66% 43%,${b},transparent 27%)`,
    'monochrome-stripes': `repeating-linear-gradient(90deg,${a} 0 5px,transparent 6px 44px),repeating-linear-gradient(0deg,transparent 0 46px,${b} 47px 48px)`,
    'bauhaus-geometry': `radial-gradient(circle at 76% 24%,${a} 0 18%,transparent 18.5%),linear-gradient(90deg,${b} 0 17%,transparent 17% 100%)`,
    'liquid-waves': `radial-gradient(ellipse at 18% 25%,${a},transparent 38%),radial-gradient(ellipse at 82% 70%,${b},transparent 39%)`,
    'sports-field': `repeating-linear-gradient(135deg,${a} 0 12px,transparent 13px 37px),linear-gradient(0deg,transparent 49%,${b} 50%,transparent 51%)`,
    'science-network': `radial-gradient(circle,${a} 0 2px,transparent 3px),repeating-linear-gradient(60deg,transparent 0 40px,${b} 41px 42px)`,
    'comic-panels': `radial-gradient(circle,${b} 0 2px,transparent 2.8px),linear-gradient(135deg,transparent 0 49%,${a} 50% 51%,transparent 52%)`,
    'digital-glitch': `repeating-linear-gradient(0deg,transparent 0 5px,${a} 6px 8px,transparent 9px 20px),linear-gradient(90deg,transparent 55%,${b} 56% 62%,transparent 63%)`,
  };
  const image = images[style.pattern] || `linear-gradient(135deg,${a},transparent,${b})`;
  const repeated = /rules|grid|halftone|matrix|leaves|fan|bubbles|scanlines|isometric|chalkboard|mosaic|stripes|field|network|panels|glitch/.test(style.pattern);
  const size = repeated ? `${Math.max(28, Math.round(width * .055))}px ${Math.max(28, Math.round(width * .055))}px` : 'auto';
  return { image, size };
};

const STOP_WORDS = new Set('yang dan atau untuk dari dengan pada dalam bisa akan agar lalu karena setelah sebelum sebuah suatu ini itu ke di nya lebih sangat juga saat secara hingga serta oleh adalah jadi sebagai kecil besar ketika dapat tanpa mulai kepada terhadap antara sebagai kita mereka'.split(' '));
const VISUAL_GROUPS: Record<string, string[]> = {
  sugar: ['gula','glukosa','sukrosa','fruktosa','pemanis','manis','karbohidrat','insulin','pankreas','energi'],
  body: ['tubuh','jantung','darah','otak','kesehatan','sehat','tidur','stres','napas','otot','pencernaan','sel','organ','metabolisme'],
  food: ['makanan','minuman','buah','sayur','nasi','roti','kopi','teh','garam','lemak','protein','porsi','masak','gizi'],
  nature: ['alam','bumi','hutan','pohon','daun','tanaman','laut','sungai','air','hujan','iklim','cuaca','udara','polusi','karbon','hewan','lingkungan'],
  tech: ['teknologi','digital','internet','ponsel','telepon','komputer','data','aplikasi','algoritma','robot','sistem','layar','jaringan','sinyal','chip'],
  life: ['hidup','kehidupan','manusia','orang','keluarga','anak','teman','masyarakat','kota','rumah','kebiasaan','pilihan','perasaan','emosi','kerja','belajar','sekolah','budaya'],
  time: ['dulu','sekarang','sejarah','abad','tahun','generasi','perubahan','berubah','perjalanan','zaman'],
};
const VISUAL_NAMES: Record<string, string> = { sugar: 'Alur gula · ilustrasi', body: 'Tubuh & kesehatan · ilustrasi', food: 'Pangan · ilustrasi', nature: 'Alam · ilustrasi', tech: 'Teknologi · ilustrasi', life: 'Kehidupan · ilustrasi', time: 'Perubahan waktu', cause: 'Sebab dan akibat', process: 'Urutan proses', compare: 'Perbandingan konsep', concept: 'Ilustrasi konsep' };

const getVisualIntent = (sentence: string): string => {
  const lower = sentence.toLowerCase();
  const words = lower.match(/[\p{L}\p{N}]+/gu) || [];
  const scores = Object.fromEntries(Object.entries(VISUAL_GROUPS).map(([key, terms]) => [key, terms.reduce((sum, term) => sum + words.filter((word) => word === term || word.startsWith(term)).length, 0)])) as Record<string, number>;
  if (scores.sugar >= 1) return 'sugar';
  if (scores.body >= 2) return 'body';
  if (scores.food >= 1) return 'food';
  if (scores.nature >= 1) return 'nature';
  if (scores.tech >= 1) return 'tech';
  if (scores.life >= 1) return 'life';
  if (scores.time >= 1 || /\b(abad|tahun|generasi|zaman)\b/.test(lower)) return 'time';
  if (/\b(banding|dibanding|berbeda|sementara|sedangkan|daripada)\b/.test(lower)) return 'compare';
  if (/\b(karena|sebab|akibat|menyebabkan|berdampak|sehingga|maka)\b/.test(lower)) return 'cause';
  if (/\b(pertama|kedua|ketiga|kemudian|selanjutnya|langkah|proses|tahap|akhirnya)\b/.test(lower)) return 'process';
  return 'concept';
};

export const getScenePlan = (script: string, fps = 30): ScenePlan[] => {
  const text = (script || '').trim();
  if (!text) return [];
  const parts = text.split(/\n+/).flatMap((paragraph) => paragraph.match(/[^.!?;…]+[.!?;…]?/g) || []).map((part) => part.trim()).filter(Boolean);
  const expanded: string[] = [];
  for (const part of parts.length ? parts : [text]) {
    const words = part.split(/\s+/);
    if (words.length <= 22) expanded.push(part);
    else for (let i = 0; i < words.length; i += 18) expanded.push(`${words.slice(i, i + 18).join(' ')}${i + 18 < words.length ? '…' : ''}`);
  }
  const safe = expanded.slice(0, 48);
  return safe.map((sentence, index) => {
    const words = sentence.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
    const visual = getVisualIntent(sentence);
    const focus = [...new Set(words.map((word) => word.toLowerCase()).filter((word) => word.length > 3 && !STOP_WORDS.has(word)))].slice(0, 3);
    const plain = sentence.replace(/[.!?;…]+$/, '');
    const title = plain.length > 86 ? `${plain.slice(0, 82).replace(/\s+\S*$/, '')}…` : plain;
    const seconds = Math.max(2.2, Math.min(8, 1.65 + words.length * 0.21));
    const label = index === 0 ? (sentence.includes('?') ? 'PERTANYAAN' : 'KONTEKS') : index === safe.length - 1 ? 'KESIMPULAN' : visual.toUpperCase();
    return { index, sentence, title, focus, label, visual, words, durationInFrames: Math.max(1, Math.round(seconds * fps)) };
  });
};

const Visual: React.FC<{ scene: ScenePlan; style: ArtStyle; width: number; height: number; progress: number; frame: number; fps: number }> = ({ scene, style, width, height, progress, frame, fps }) => {
  const time = frame / fps;
  const ambientPhase = (time * Math.PI * 2) / theme.timing.ambientCycleSeconds;
  const drift = Math.sin(ambientPhase) * width * .018;
  const revealItem = (index: number) => clamp01(spring({ frame: frame - Math.round(fps * theme.timing.visualDelaySeconds) - index * theme.stagger.shapeFrames, fps, config: theme.spring.snappy }));
  const subject = scene.focus[0] || 'GAGASAN';
  const common = <>
    <circle cx="690" cy="210" r="176" fill={style.second} opacity=".14" transform={`translate(${drift} 0)`} />
    <ellipse cx="480" cy="280" rx="360" ry="176" fill="none" stroke={style.accent} strokeOpacity=".22" strokeWidth="2" transform={`translate(${-drift * .7} 0)`} />
  </>;
  let art: React.ReactNode;
  if (scene.visual === 'sugar') art = <>
    <path d="M190 410 Q160 330 190 245 L175 135 Q235 92 280 145 L285 250 Q320 318 291 411Z" fill={style.accent} opacity=".3" stroke={style.accent} strokeWidth="8" />
    <circle cx="234" cy="112" r="40" fill={style.accent} opacity=".55" />
    <path d="M305 270 C440 175 525 400 760 245" fill="none" stroke={style.second} strokeOpacity=".9" strokeWidth="32" strokeLinecap="round" />
    <path d="M305 270 C440 175 525 400 760 245" fill="none" stroke={style.ink} strokeOpacity=".27" strokeWidth="4" strokeDasharray="8 18" />
    {Array.from({length: 7}, (_,i) => { const t=(progress*.82+i/7)%1; const cx=330+430*t; const cy=270+Math.sin(t*Math.PI*2+ambientPhase*.72)*72; return <g key={i} opacity={revealItem(i)} transform={`translate(${cx} ${cy}) rotate(${time*42+i*23})`}><rect x="-17" y="-17" width="34" height="34" rx="7" fill={i%2?style.accent:style.ink} /><circle r="4" fill={style.bg} /></g>; })}
    <path d="M274 232 C296 208 326 218 331 247 C337 279 299 298 279 281 C260 266 259 248 274 232Z" fill={style.second} />
    <text x="570" y="440" textAnchor="middle" fill={style.ink} fontSize="24" fontWeight="700" letterSpacing="4">ILUSTRASI · GULA &amp; ENERGI</text>
  </>;
  else if (scene.visual === 'body') art = <>
    <path d="M205 420 Q185 260 240 210 L220 148 Q250 106 290 148 L274 218 Q334 280 304 420Z" fill={style.accent} opacity=".32" stroke={style.accent} strokeWidth="7" />
    <path d="M425 300 L492 300 L520 230 L550 355 L584 276 L610 300 L760 300" fill="none" stroke={style.second} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M340 265 C380 230 411 263 398 290 C384 320 352 306 340 265Z" fill={style.second} />
    <text x="610" y="390" textAnchor="middle" fill={style.ink} fontSize="26" fontWeight="750">SKEMA TUBUH ILUSTRATIF</text>
  </>;
  else if (scene.visual === 'food') art = <>
    <circle cx="310" cy="280" r="172" fill="none" stroke={style.ink} strokeOpacity=".55" strokeWidth="13" /><circle cx="310" cy="280" r="136" fill={style.accent} opacity=".14" />
    <ellipse cx="260" cy="265" rx="50" ry="33" fill={style.accent} transform="rotate(-18 260 265)" /><path d="M245 230 Q255 210 279 215" fill="none" stroke={style.ink} strokeWidth="8" />
    <circle cx="370" cy="230" r="38" fill={style.second} /><rect x="335" y="315" width="88" height="70" rx="12" fill={style.accent} opacity=".72" />
    <text x="650" y="280" textAnchor="middle" fill={style.ink} fontSize="44" fontWeight="850">{subject.toUpperCase()}</text><text x="650" y="334" textAnchor="middle" fill={style.muted} fontSize="24">KEBIASAAN · PILIHAN · PORSI</text>
  </>;
  else if (scene.visual === 'nature') art = <>
    <path d={`M0 382 L145 ${185+drift*.25} L320 382 L505 210 L740 390 L870 252 L960 345 V520 H0Z`} fill={style.second} opacity=".48" />
    <path d="M0 414 Q230 320 440 430 T960 398 V520 H0Z" fill={style.accent} opacity=".42" />
    <circle cx="760" cy="115" r="61" fill={style.accent} opacity=".88" />
    {[120,210,340,700].map((cx,i)=><g key={i} opacity={revealItem(i)} transform={`translate(${cx+Math.sin(ambientPhase*.8+i)*12} 0)`}><path d={`M${cx} 432 v-118 m0 36 q-65 -74 -83 -11 q45 67 83 51 m0 -28 q66 -88 89 -20 q-52 78 -89 68`} fill="none" stroke={i%2?style.ink:style.accent} strokeWidth="13" strokeLinecap="round" /></g>)}
  </>;
  else if (scene.visual === 'tech') art = <>
    <rect x="170" y="78" width="250" height="390" rx="43" fill={style.accent} opacity=".22" stroke={style.accent} strokeWidth="9" /><rect x="191" y="110" width="208" height="318" rx="19" fill={style.second} opacity=".25" />
    {Array.from({length:5},(_,i)=>{const cx=565+(i%2)*164,cy=142+i*68;return <g key={i} opacity={revealItem(i)}><path d={`M420 205 C480 205 475 ${cy} ${cx} ${cy}`} fill="none" stroke={style.accent} strokeOpacity=".75" strokeWidth="4"/><circle cx={cx} cy={cy} r="15" fill={i%2?style.second:style.accent}/></g>;})}
    <text x="655" y="500" textAnchor="middle" fill={style.ink} fontSize="27" fontWeight="750">SISTEM · JARINGAN · INFORMASI</text>
  </>;
  else if (scene.visual === 'life') art = <>
    <path d="M0 410 H960 V520 H0Z" fill={style.second} opacity=".28" />
    {[45,200,365,530,700].map((x,i)=>{const h=170+(i%3)*70;return <g key={x} opacity={revealItem(i)}><rect x={x} y={410-h} width="130" height={h} rx="9" fill={i%2?style.accent:style.second} opacity=".34"/>{[0,1,2].map(r=>[0,1].map(c=><rect key={`${r}-${c}`} x={x+22+c*49} y={425-h+r*49} width="22" height="25" fill={style.ink} opacity=".4"/>))}</g>;})}
    {[150,370,590,810].map((x,i)=><g key={x} opacity={revealItem(i)} transform={`translate(0 ${Math.sin(ambientPhase*2.8+i)*4})`}><circle cx={x} cy="355" r="21" fill={i%2?style.ink:style.accent}/><path d={`M${x-22} 380 Q${x} 365 ${x+22} 380 L${x+34} 460 H${x-34}Z`} fill={i%2?style.ink:style.accent}/></g>)}
  </>;
  else if (scene.visual === 'time') art = <>
    <path d="M125 290 H835" stroke={style.accent} strokeWidth="8" strokeLinecap="round" />
    {[210,480,750].map((cx,i)=><g key={cx} opacity={revealItem(i)}><circle cx={cx} cy="290" r="26" fill={i===1?style.second:style.accent}/><text x={cx} y="210" textAnchor="middle" fill={style.ink} fontSize="26" fontWeight="700">{(scene.focus[i]||['AWAL','PERUBAHAN','KINI'][i]).toUpperCase()}</text><path d={`M${cx} 250 V264`} stroke={style.ink} strokeWidth="4"/></g>)}
    <path d="M750 280 l42 10 -42 10" fill={style.accent}/>
  </>;
  else {
    const count = scene.visual === 'compare' ? 2 : 3;
    art = <>
      {scene.visual === 'compare' && <path d="M480 105 V420" stroke={style.accent} strokeOpacity=".5" strokeWidth="3" strokeDasharray="10 12"/>}
      {Array.from({length:count},(_,i)=>{const cx=count===2?260+i*440:185+i*295;const cy=270+Math.sin(ambientPhase+i)*8;return <g key={i} opacity={revealItem(i)}><circle cx={cx} cy={cy} r="90" fill={i===1?style.second:style.accent} opacity=".19" stroke={i===1?style.second:style.accent} strokeWidth="6"/><circle cx={cx} cy={cy} r="64" fill="none" stroke={style.ink} strokeOpacity=".58" strokeWidth="2"/><text x={cx} y={cy+8} textAnchor="middle" fill={style.ink} fontSize="22" fontWeight="750">{(scene.focus[i]||['KONTEKS','PERUBAHAN','DAMPAK'][i]).toUpperCase().slice(0,13)}</text>{i<count-1&&scene.visual!=='compare'&&<path d={`M${cx+105} ${cy} H${cx+185}`} stroke={style.second} strokeWidth="6" markerEnd="url(#arrow)"/>}</g>;})}
      <text x="480" y="460" textAnchor="middle" fill={style.muted} fontSize="22" letterSpacing="3">{scene.visual==='cause'?'HUBUNGAN KONSEP':scene.visual==='compare'?'PERBANDINGAN · TANPA SKALA DATA':'URUTAN DALAM NARASI'}</text>
    </>;
  }
  return <div style={{ position: 'relative', width: '100%', height: '100%', perspective: 900, overflow: 'hidden', transform: `translate3d(${drift*.24}px,${Math.cos(ambientPhase*.72)*height*.008}px,0)` }}>
    <svg viewBox="0 0 960 520" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
      <defs><linearGradient id={`glow-${scene.index}`} x1="0" x2="1" y1="0" y2="1"><stop stopColor={style.accent} stopOpacity=".23"/><stop offset="1" stopColor={style.second} stopOpacity=".04"/></linearGradient></defs>
      <rect x="20" y="20" width="920" height="480" rx="54" fill={`url(#glow-${scene.index})`} stroke={style.accent} strokeOpacity=".22" strokeWidth="2" />{common}
      <g style={{ transform: `translate(${scene.index % 2 === 0 ? -7 + progress * 7 : 7 - progress * 7} ${interpolate(progress, [0, 1], [10, -8], { easing: theme.ease.inOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}) scale(${interpolate(progress, [0, 1], [1.025, 1.085], { easing: theme.ease.inOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})`, transformOrigin: 'center' }}>{art}</g>
    </svg>
    <div style={{ position: 'absolute', top: height*.035, left: width*.04, color: style.accent, font: `700 ${Math.max(12,width*.019)}px monospace`, letterSpacing: '.16em' }}>{VISUAL_NAMES[scene.visual] || VISUAL_NAMES.concept}</div>
  </div>;
};

const wordWeight = (word: string) => .48 + Math.max(1,(word.match(/[aeiouaiueo]+/gi)||[]).length)*.24 + Math.max(0,word.length-5)*.035;
const getActiveWord = (scene: ScenePlan, progress: number) => {
  const weights=scene.words.map(wordWeight);const total=weights.reduce((sum,value)=>sum+value,0)||1;let cursor=0;
  for(let i=0;i<weights.length;i++){cursor+=weights[i]/total;if(progress<cursor)return i;}return Math.max(0,weights.length-1);
};
const getWordStartFrame = (scene: ScenePlan, wordIndex: number) => {
  const weights = scene.words.map(wordWeight);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const elapsed = weights.slice(0, wordIndex).reduce((sum, value) => sum + value, 0);
  return Math.round((elapsed / total) * Math.max(0, scene.durationInFrames - 1));
};

const SceneFrame: React.FC<{ scene: ScenePlan; style: ArtStyle; direction: ArtDirection; sceneCount: number; chapterLabels: boolean }> = ({ scene, style, direction, sceneCount, chapterLabels }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const time = frame / fps;
  const ambientPhase = (time * Math.PI * 2) / theme.timing.ambientCycleSeconds;
  const endFrame = Math.max(1, scene.durationInFrames - 1);
  const progress = interpolate(frame, [0, endFrame], [0, 1], { easing: theme.ease.inOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const activeWord = getActiveWord(scene, progress);
  const exitFrames = Math.max(1, Math.min(Math.round(fps * theme.timing.exitSeconds), Math.round(scene.durationInFrames * 0.3)));
  const exitStart = Math.max(0, endFrame - exitFrames);
  const exit = interpolate(frame, [exitStart, endFrame], [0, 1], { easing: theme.ease.in, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sceneOpacity = 1 - exit;
  const revealAt = (delayFrames: number, snappy = false) => clamp01(spring({ frame: frame - delayFrames, fps, config: snappy ? theme.spring.snappy : theme.spring.smooth }));
  const titleDelay = Math.round(fps * theme.timing.titleDelaySeconds);
  const visualDelay = Math.round(fps * theme.timing.visualDelaySeconds);
  const visualEnter = revealAt(visualDelay);
  const titleWords = scene.title.split(/\s+/).filter(Boolean);
  const vertical = height > width;
  const margin = width * 0.085;
  const titleSize = width * (vertical ? 0.09 : 0.064);
  const leftLayout = direction.layout === 'left' || direction.layout === 'split';
  const rightLayout = direction.layout === 'right';
  const posterLayout = direction.layout === 'poster';
  const titleTop = direction.layout === 'top' ? height * .12 : posterLayout ? height * .13 : height * (vertical ? .18 : .16);
  const titleAlign = direction.align;
  const titleWidth = direction.layout === 'split' ? '55%' : undefined;
  const titleLeft = margin;
  const titleRight = margin;
  const visualTop = direction.layout === 'top' ? height * .31 : (leftLayout || rightLayout) ? height * .34 : posterLayout ? height * .4 : height * (vertical ? .39 : .37);
  const visualTravel = interpolate(visualEnter, [0, 1], [1, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const visualX = direction.motion === 'slide' ? visualTravel * (direction.align === 'right' ? -width * 0.07 : width * 0.07) : direction.motion === 'wipe' ? visualTravel * width * 0.13 : 0;
  const visualY = direction.motion === 'rise' ? visualTravel * height * 0.035 : direction.motion === 'orbit' ? visualTravel * height * 0.018 : direction.motion === 'float' ? Math.sin(ambientPhase * 1.2) * height * 0.003 : 0;
  const visualScaleIn = interpolate(visualEnter, [0, 1], [direction.motion === 'zoom' || direction.motion === 'pulse' ? 0.86 : 0.92, 1], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const visualRotation = direction.motion === 'orbit' ? interpolate(visualEnter, [0, 1], [-3, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const captionStart = Math.max(0, Math.min(activeWord - 3, Math.max(0, scene.words.length - 7)));
  const captionWords = scene.words.slice(captionStart, captionStart + 7).map((word, index) => ({ word, sourceIndex: captionStart + index }));
  const captionEnter = revealAt(Math.round(fps * theme.timing.entranceSeconds));
  const focusEnter = revealAt(visualDelay + theme.stagger.blockFrames);
  const ringStyle: React.CSSProperties = { position: 'absolute', width: width * .72, aspectRatio: '1', right: -width * .27, top: height * .07, borderRadius: '50%', border: `1px solid ${style.accent}25`, transform: `translate3d(${Math.sin(ambientPhase*.72) * width * .018}px,${Math.cos(ambientPhase*.56) * height * .01}px,0) rotate(${time * 9}deg)` };
  const texture = textureFor(style, width);
  const bgChannels = [1, 3, 5].map((offset) => parseInt(style.bg.slice(offset, offset + 2), 16) / 255);
  const isLightBackground = (0.2126 * bgChannels[0] + 0.7152 * bgChannels[1] + 0.0722 * bgChannels[2]) > 0.55;
  const gradeOpacity = isLightBackground ? theme.layers.gradeLightOpacity : theme.layers.gradeDarkOpacity;
  const grainTexture = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")`;
  const captionBottom = vertical ? height * 0.12 : height * 0.066;
  const titleJustify = titleAlign === 'left' ? 'flex-start' : titleAlign === 'right' ? 'flex-end' : 'center';
  const exitY = interpolate(exit, [0, 1], [0, direction.motion === 'rise' ? -height * 0.018 : height * 0.012], { easing: theme.ease.in, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exitScale = interpolate(exit, [0, 1], [1, 0.985], { easing: theme.ease.in, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ overflow: 'hidden', padding: margin, color: style.ink, backgroundColor: style.bg, fontFamily: `${style.font}, ${theme.fonts.body}`, opacity: sceneOpacity, transform: `translate3d(0,${exitY}px,0) scale(${exitScale})` }}>
    {/* Layer 1 — atmospheric background mesh and preset texture. */}
    <AbsoluteFill style={{ zIndex: 0, background: `radial-gradient(ellipse at 83% 18%,${style.second}42,transparent 40%),linear-gradient(145deg,${style.bg},${style.mid} 62%,${style.bg})` }} />
    <div style={{ position: 'absolute', zIndex: 0, width: width * 1.2, height: width * 1.2, top: -height * 0.22, right: -width * 0.48, borderRadius: '50%', filter: `blur(${width * 0.065}px)`, background: `radial-gradient(circle,${style.accent}22,transparent 68%)`, transform: `translate3d(${Math.sin(ambientPhase*.47) * width * 0.018}px,${Math.cos(ambientPhase*.37) * height * 0.01}px,0)` }} />
    <div style={ringStyle} />
    <div style={{ position: 'absolute', zIndex: 0, inset: 0, opacity: .16, backgroundImage: texture.image, backgroundSize: texture.size, backgroundPosition: `${Math.sin(ambientPhase*.17) * width * .012}px center`, maskImage: 'linear-gradient(to bottom,black,transparent 88%)' }} />
    {/* Layer 2 — contextual SVG asset stage; its camera move supplies a restrained Ken Burns pass. */}
    <div style={{ position: 'absolute', zIndex: 1, top: visualTop, left: rightLayout ? '3%' : margin, right: leftLayout ? '3%' : margin, width: leftLayout || rightLayout ? '58%' : undefined, height: height * (vertical ? .32 : .39), opacity: visualEnter * sceneOpacity, transform: `translate3d(${visualX}px,${visualY}px,0) scale(${direction.visualScale * visualScaleIn}) rotate(${visualRotation}deg)`, transformOrigin: rightLayout ? 'right center' : 'left center' }}>
      <Visual scene={scene} style={style} width={width - margin * 2} height={height * (vertical ? .32 : .39)} progress={progress} frame={frame} fps={fps} />
    </div>
    {/* Layer 3 — chapter type, staggered title words, focus chip, and narration captions. */}
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: style.muted, fontFamily: theme.fonts.mono, fontSize: width * .018, letterSpacing: '.11em' }}><span>ARKX AUTO Motion / NARASI</span>{chapterLabels && <span style={{ color: style.muted }}>{String(scene.index + 1).padStart(2, '0')} — {scene.label}</span>}</div>
    <div style={{ position: 'absolute', zIndex: 2, top: titleTop, left: titleLeft, right: titleRight, width: titleWidth, opacity: sceneOpacity }}>
      <h1 style={{ margin: 0, maxWidth: '100%', display: 'flex', flexWrap: 'wrap', justifyContent: titleJustify, columnGap: Math.max(8, titleSize * 0.1), rowGap: titleSize * 0.035, color: style.ink, fontSize: titleSize, lineHeight: direction.layout === 'poster' ? .94 : 1.02, fontWeight: direction.titleWeight, letterSpacing: direction.titleTracking, textTransform: posterLayout ? 'uppercase' : 'none', overflowWrap: 'anywhere' }}>
        {titleWords.map((word, index) => { const p = revealAt(titleDelay + index * theme.stagger.wordFrames, true); const y = interpolate(p, [0, 1], [titleSize * .28, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }); const scale = interpolate(p, [0, 1], [.94, 1], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }); return <span key={`${index}-${word}`} style={{ display: 'inline-block', opacity: p, transform: `translate3d(0,${y}px,0) scale(${scale})` }}>{word}</span>; })}
      </h1>
    </div>
    <div style={{ position: 'absolute', zIndex: 2, left: margin, top: height * (vertical ? .735 : .77), padding: `${height * .009}px ${width * .02}px`, border: `1px solid ${style.accent}44`, borderRadius: 999, color: style.muted, background: `${style.mid}dd`, fontSize: width * .018, fontWeight: 750, letterSpacing: '.05em', opacity: focusEnter * sceneOpacity, transform: `translate3d(0,${interpolate(focusEnter, [0, 1], [height * .012, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px,0) scale(${interpolate(focusEnter, [0, 1], [.96, 1], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})` }}>{scene.focus.slice(0, 2).join(' · ').toUpperCase() || scene.label}</div>
    <div style={{ position: 'absolute', zIndex: 2, left: margin, right: margin, bottom: captionBottom, minHeight: height * .064, display: 'flex', alignContent: 'center', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', columnGap: Math.max(8, width * .015), rowGap: Math.max(6, height * .008), padding: `${height * .018}px ${width * .025}px`, border: `1px solid ${style.accent}55`, borderRadius: direction.captionShape, background: `${style.bg}ec`, color: style.ink, fontSize: width * .026, lineHeight: 1.25, fontWeight: 650, opacity: captionEnter * sceneOpacity, transform: `translate3d(0,${interpolate(captionEnter, [0, 1], [height * .012, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px,0)` }}>
      {captionWords.map(({ word, sourceIndex }) => { const active = sourceIndex === activeWord; const wordStart = getWordStartFrame(scene, sourceIndex); const lead = Math.round(fps * theme.timing.captionLeadSeconds); const p = clamp01(spring({ frame: frame - Math.max(0, wordStart - lead), fps, config: theme.spring.snappy })); const activeP = active ? clamp01(spring({ frame: frame - wordStart, fps, config: theme.spring.snappy })) : 0; const y = interpolate(p, [0, 1], [height * .009, 0], { easing: theme.ease.out, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }); return <span key={sourceIndex} style={{ position: 'relative', display: 'inline-block', padding: active ? `0 ${width * .012}px` : 0, borderRadius: 8, color: active ? style.bg : style.ink, background: active ? style.accent : 'transparent', opacity: p, transform: `translate3d(0,${y}px,0) scale(${1 + activeP * .05})` }}>{word}</span>; })}
    </div>
    <div style={{ position: 'absolute', zIndex: 3, left: margin, right: margin, bottom: height * .029, height: Math.max(5, height * .004), borderRadius: 999, background: `${theme.colors.paper}26` }}><div style={{ width: `${clamp01((scene.index + progress) / Math.max(1, sceneCount)) * 100}%`, height: '100%', borderRadius: 999, background: style.second }} /></div>
    {/* Layer 4 — restrained color grade; Layer 5 — moving grain and topmost vignette. */}
    <AbsoluteFill style={{ zIndex: 4, pointerEvents: 'none', background: `linear-gradient(180deg,rgba(0,0,0,.1),transparent 28%,transparent 72%,rgba(0,0,0,.2))` }} />
    <AbsoluteFill style={{ zIndex: 4, pointerEvents: 'none', backgroundColor: style.accent, mixBlendMode: 'soft-light', opacity: gradeOpacity }} />
    <AbsoluteFill style={{ zIndex: 5, pointerEvents: 'none', backgroundImage: grainTexture, backgroundSize: `${theme.layers.grainSize}px`, backgroundPosition: `${((time * theme.layers.grainDriftXPerSecond) % theme.layers.grainSize)}px ${((time * theme.layers.grainDriftYPerSecond) % theme.layers.grainSize)}px`, opacity: theme.layers.grainOpacity, mixBlendMode: isLightBackground ? 'multiply' : 'overlay' }} />
    <AbsoluteFill style={{ zIndex: 6, pointerEvents: 'none', background: 'radial-gradient(ellipse at center,transparent 56%,rgba(0,0,0,.22) 100%)', opacity: theme.layers.vignetteOpacity }} />
  </AbsoluteFill>;
};

export const ExplainerVideo: React.FC<ExplainerProps> = (props) => {
  const { fps } = useVideoConfig();
  const plan = getScenePlan(props.script, fps);
  const style = ART_STYLES[props.styleId] || ART_STYLES.cinema;
  let from = 0;
  const sequence = plan.map((scene) => {
    const item = { scene, from };
    from += scene.durationInFrames;
    return item;
  });
  return <AbsoluteFill style={{ backgroundColor: style.bg }}>
    {sequence.map(({ scene, from: start }) => <Sequence key={scene.index} from={start} durationInFrames={scene.durationInFrames} name={`Scene ${scene.index + 1}`}><SceneFrame scene={scene} style={style} direction={directionFor(props.styleId)} sceneCount={plan.length} chapterLabels={true} /></Sequence>)}
    {props.narrationSrc ? <Audio src={staticFile(props.narrationSrc)} volume={Math.max(0, Math.min(1, props.volume ?? 1))} /> : null}
  </AbsoluteFill>;
};
