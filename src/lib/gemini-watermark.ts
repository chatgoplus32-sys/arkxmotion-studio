/**
 * Gemini/Veo watermark removal — exact math via @pilio/gemini-watermark-remover.
 *
 * Uses Reverse Alpha Blending: the Gemini watermark is a known logo rendered
 * with a known alpha map at a known position (bottom-right). The engine
 * mathematically inverts the blend instead of hallucinating pixels like
 * inpainting does, so results are lossless on supported outputs.
 *
 * No ONNX / WASM runtime needed — pure JS, works in any modern browser.
 */

import {
  removeWatermarkFromImageDataSync,
  detectWatermarkConfig,
  calculateWatermarkPosition,
} from '@pilio/gemini-watermark-remover'

export interface GeminiRemovalMeta {
  applied: boolean
  skipReason: string | null
  size: number | null
  position: { x: number; y: number; width: number; height: number } | null
  passCount: number
}

export interface GeminiRemovalResult {
  imageData: ImageData
  meta: GeminiRemovalMeta
}

/**
 * Get the expected watermark region for an image of the given size.
 * Used to auto-apply the mask so the user does not have to draw it.
 */
export function getGeminiWatermarkRegion(
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const config = detectWatermarkConfig(width, height)
  return calculateWatermarkPosition(width, height, config)
}

/**
 * Remove the Gemini/Veo watermark from raw pixel data.
 * Returns the cleaned ImageData plus metadata about what was done.
 * Never throws on "no watermark" — check `meta.applied` instead.
 */
export function removeGeminiWatermark(imageData: ImageData): GeminiRemovalResult {
  const result = removeWatermarkFromImageDataSync(imageData)
  return {
    imageData: result.imageData as ImageData,
    meta: {
      applied: result.meta.applied,
      skipReason: result.meta.skipReason,
      size: result.meta.size,
      position: result.meta.position,
      passCount: result.meta.passCount,
    },
  }
}
