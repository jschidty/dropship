import type { CompactSimSnapshot, PlayerId } from "@drop-ship/protocol";

export const SNAPSHOT_WARN_BYTES = 1_500_000;
export const SNAPSHOT_MAX_BYTES = 2_000_000;

export type StoredSnapshot = Readonly<{
  tick: number;
  authorPlayerId: PlayerId;
  snapshot: CompactSimSnapshot;
  byteLength: number;
}>;

export type SnapshotStore = {
  write: (authorPlayerId: PlayerId, snapshot: CompactSimSnapshot) => StoredSnapshot;
  latestAtOrBefore: (tick: number) => StoredSnapshot | null;
  list: () => readonly StoredSnapshot[];
};

export function createSnapshotStore(maxSnapshots = 10): SnapshotStore {
  const snapshots: StoredSnapshot[] = [];

  return {
    write(authorPlayerId, snapshot) {
      const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

      if (byteLength >= SNAPSHOT_MAX_BYTES) {
        throw new Error(`Snapshot ${snapshot.tick} is ${byteLength} bytes`);
      }

      const stored: StoredSnapshot = {
        tick: snapshot.tick,
        authorPlayerId,
        snapshot,
        byteLength,
      };

      snapshots.push(stored);
      snapshots.sort((a, b) => a.tick - b.tick);

      while (snapshots.length > maxSnapshots) {
        snapshots.shift();
      }

      return stored;
    },
    latestAtOrBefore(tick) {
      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        if (snapshots[index].tick <= tick) {
          return snapshots[index];
        }
      }

      return null;
    },
    list() {
      return snapshots.slice();
    },
  };
}
