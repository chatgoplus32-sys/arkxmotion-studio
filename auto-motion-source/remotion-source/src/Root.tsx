import React from 'react';
import { Composition } from 'remotion';
import { ExplainerVideo, getScenePlan, ExplainerProps } from './ExplainerVideo';

const defaultProps: ExplainerProps = {
  script: `Gula hadir dalam banyak makanan yang kita konsumsi setiap hari. Di dalam tubuh, gula menjadi bagian dari proses penyediaan energi, tetapi jumlah dan konteksnya tetap penting.
Memahami label makanan dan ukuran porsi membantu kita membuat pilihan yang lebih sadar. Visual ini adalah ilustrasi konsep.`,
  styleId: 'cinema',
  format: 'vertical',
  narrationSrc: '',
  volume: 1,
};

const dimensions = (format: ExplainerProps['format']) => {
  if (format === 'horizontal') return { width: 1920, height: 1080 };
  if (format === 'square') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ARKXAutoMotionExplainer"
    component={ExplainerVideo}
    defaultProps={defaultProps}
    durationInFrames={450}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={({ props }) => {
      const plan = getScenePlan(props.script || defaultProps.script, 30);
      return {
        durationInFrames: Math.max(1, plan.reduce((sum, scene) => sum + scene.durationInFrames, 0)),
        ...dimensions(props.format || 'vertical'),
      };
    }}
  />
);
