export type UiStore<T> = Readonly<{
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  setSnapshot: (snapshot: T) => void;
}>;

export function createUiStore<T>(initialSnapshot: T): UiStore<T> {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    setSnapshot(nextSnapshot) {
      if (Object.is(snapshot, nextSnapshot)) {
        return;
      }

      snapshot = nextSnapshot;

      for (const listener of listeners) {
        listener();
      }
    },
  };
}
