import type { MatchConfig } from "@drop-ship/protocol";

export const MATCH_CONFIG_KEY = "match:config";

export async function readOrCreateStoredMatchConfig(
  storage: DurableObjectStorage | undefined,
  createConfig: () => MatchConfig
): Promise<MatchConfig> {
  const stored = await storage?.get<MatchConfig>(MATCH_CONFIG_KEY);

  if (stored) {
    return stored;
  }

  const config = createConfig();
  await storage?.put(MATCH_CONFIG_KEY, config);
  return config;
}
