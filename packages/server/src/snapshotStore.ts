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
  write: (
    authorPlayerId: PlayerId,
    snapshot: CompactSimSnapshot
  ) => Promise<StoredSnapshot>;
  latestAtOrBefore: (tick: number) => Promise<StoredSnapshot | null>;
  list: () => Promise<readonly StoredSnapshot[]>;
};

export type CreateSnapshotStoreOptions = Readonly<{
  maxSnapshots?: number;
  storage?: DurableObjectStorage;
}>;

const SNAPSHOT_PREFIX = "snapshot:";

export function createSnapshotStore(
  options: CreateSnapshotStoreOptions = {}
): SnapshotStore {
  const maxSnapshots = options.maxSnapshots ?? 10;
  const storage = options.storage;
  const snapshots: StoredSnapshot[] = [];
  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) {
      return;
    }

    loaded = true;

    if (!storage) {
      return;
    }

    const stored = await storage.list<StoredSnapshot>({
      prefix: SNAPSHOT_PREFIX,
    });

    snapshots.push(...stored.values());
    pruneSnapshots();
  }

  function pruneSnapshots(): void {
    snapshots.sort((a, b) => a.tick - b.tick);

    while (snapshots.length > maxSnapshots) {
      snapshots.shift();
    }
  }

  return {
    async write(authorPlayerId, snapshot) {
      await load();

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
      pruneSnapshots();

      await storage?.put(snapshotKey(stored.tick), stored);

      return stored;
    },
    async latestAtOrBefore(tick) {
      await load();

      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        if (snapshots[index].tick <= tick) {
          return snapshots[index];
        }
      }

      return null;
    },
    async list() {
      await load();

      return snapshots.slice();
    },
  };
}

function snapshotKey(tick: number): string {
  return `${SNAPSHOT_PREFIX}${tick.toString().padStart(10, "0")}`;
}
