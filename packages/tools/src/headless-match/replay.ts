import type {
  CommandBatch,
  MatchConfig,
  ReplayFile,
  ReplayHash,
} from "@drop-ship/protocol";

export function createHeadlessReplayFile(options: {
  match: MatchConfig;
  commandBatches: readonly CommandBatch[];
  expectedHashes: readonly ReplayHash[];
}): ReplayFile {
  return {
    version: 1,
    match: options.match,
    commandBatches: options.commandBatches.slice(),
    expectedHashes: options.expectedHashes.slice(),
  };
}
