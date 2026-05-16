import type { CommandBatch } from "./commands";
import type { MatchConfig } from "./matchConfig";

export type ReplayHash = Readonly<{
  tick: number;
  hash: string;
}>;

export type ReplayFile = Readonly<{
  version: 1;
  match: MatchConfig;
  commandBatches: readonly CommandBatch[];
  expectedHashes: readonly ReplayHash[];
}>;
