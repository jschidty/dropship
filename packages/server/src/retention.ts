export type RetentionState = Readonly<{
  archiveRequested: boolean;
  cleanupRequested: boolean;
}>;

export function createRetentionState(): RetentionState {
  return {
    archiveRequested: false,
    cleanupRequested: false,
  };
}

export function markArchiveRequested(state: RetentionState): RetentionState {
  return {
    ...state,
    archiveRequested: true,
  };
}

export function markCleanupRequested(state: RetentionState): RetentionState {
  return {
    ...state,
    cleanupRequested: true,
  };
}
