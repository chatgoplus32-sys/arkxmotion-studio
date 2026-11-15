import { Easing } from 'remotion';

/** Shared motion-design tokens. The 31 ArtStyle presets provide their own palettes. */
export const theme = {
  colors: {
    paper: '#ffffff',
    ink: '#000000',
  },
  fonts: {
    body: 'Inter, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
  timing: {
    entranceSeconds: 0.42,
    titleDelaySeconds: 0.03,
    visualDelaySeconds: 0.1,
    captionLeadSeconds: 0.16,
    exitSeconds: 0.3,
    ambientCycleSeconds: 4.2,
  },
  stagger: {
    wordFrames: 3,
    shapeFrames: 4,
    blockFrames: 6,
  },
  layers: {
    gradeDarkOpacity: 0.12,
    gradeLightOpacity: 0.08,
    grainOpacity: 0.035,
    vignetteOpacity: 0.2,
    grainSize: 220,
    grainDriftXPerSecond: 43,
    grainDriftYPerSecond: 79,
  },
} as const;

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
