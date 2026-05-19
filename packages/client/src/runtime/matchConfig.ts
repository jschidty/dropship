import { createMinimalSkirmishConfig } from "@drop-ship/content";
import type { MatchConfig, PlayerId } from "@drop-ship/protocol";

export const DEFAULT_LOCAL_PLAYER_ID = 1 satisfies PlayerId;

export function createLocalMatchConfig(seed?: number, stressUnits?: number): MatchConfig {
  const config = createMinimalSkirmishConfig({ seed });
  const totalUnits = Math.max(0, Math.floor(stressUnits ?? 0));

  if (totalUnits <= config.initialUnits.length) {
    return config;
  }

  const templateId = config.initialUnits[0]?.templateId ?? 1;
  const initialUnits = [...config.initialUnits];

  for (let index = initialUnits.length; index < totalUnits; index += 1) {
    const owner: PlayerId = index % 2 === 0 ? 1 : 2;
    const ring = Math.floor(index / 48);
    const angle = index * 2.399963229728653;
    const radius = 42 + ring * 7 + (index % 7) * 0.4;

    initialUnits.push({
      owner,
      templateId,
      position: {
        x: Math.cos(angle) * radius,
        y: ((index % 9) - 4) * 1.4,
        z: -60 + Math.sin(angle) * radius,
      },
    });
  }

  return {
    ...config,
    matchId: `${config.matchId}-stress-${totalUnits}`,
    initialUnits,
  };
}
