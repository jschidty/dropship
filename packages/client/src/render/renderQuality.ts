import type { RenderQualityMode } from "../types";
import { clamp } from "./renderMath";

export type RenderQualityConfig = Readonly<{
  mode: RenderQualityMode;
  maxRenderPixelRatio: number;
  minRenderPixelRatio: number;
  pixelRatioStep: number;
  lowFpsPixelRatioThreshold: number;
  planetGlowEnabled: boolean;
  planetGlowBillboardScale: number;
  ringThetaSegments: number;
  ringPhiSegments: number;
  cullPlanetAtmosphere: boolean;
  cullPlanetRings: boolean;
}>;

export const DEFAULT_RENDER_QUALITY_MODE: RenderQualityMode = "interactive";

export const RENDER_QUALITY_CONFIGS: Record<RenderQualityMode, RenderQualityConfig> = {
  interactive: {
    mode: "interactive",
    maxRenderPixelRatio: 1,
    minRenderPixelRatio: 0.7,
    pixelRatioStep: 0.15,
    lowFpsPixelRatioThreshold: 58,
    planetGlowEnabled: false,
    planetGlowBillboardScale: 2.42,
    ringThetaSegments: 128,
    ringPhiSegments: 4,
    cullPlanetAtmosphere: true,
    cullPlanetRings: true,
  },
  cinematic: {
    mode: "cinematic",
    maxRenderPixelRatio: 1.25,
    minRenderPixelRatio: 1,
    pixelRatioStep: 0.1,
    lowFpsPixelRatioThreshold: 55,
    planetGlowEnabled: true,
    planetGlowBillboardScale: 3.08,
    ringThetaSegments: 256,
    ringPhiSegments: 8,
    cullPlanetAtmosphere: false,
    cullPlanetRings: false,
  },
};

export function getPreferredRenderPixelRatio(
  renderQuality: RenderQualityConfig
): number {
  return clamp(
    window.devicePixelRatio,
    renderQuality.minRenderPixelRatio,
    renderQuality.maxRenderPixelRatio
  );
}
