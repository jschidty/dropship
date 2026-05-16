import {
  handleKey,
  type EntityHandle,
  type StableHandleKey,
} from "@drop-ship/protocol";

export type RuntimeEntityId = number;

export type EntityIdAllocator = {
  nextId: number;
  handleToRuntime: Map<StableHandleKey, RuntimeEntityId>;
  runtimeToHandle: Map<RuntimeEntityId, EntityHandle>;
};

export function createEntityIdAllocator(nextId = 1): EntityIdAllocator {
  return {
    nextId,
    handleToRuntime: new Map(),
    runtimeToHandle: new Map(),
  };
}

export function allocateHandle(ids: EntityIdAllocator): EntityHandle {
  const handle = {
    id: ids.nextId,
    generation: 1,
  };

  ids.nextId += 1;
  return handle;
}

export function bindHandle(
  ids: EntityIdAllocator,
  handle: EntityHandle,
  runtimeEntityId: RuntimeEntityId
): void {
  ids.handleToRuntime.set(handleKey(handle), runtimeEntityId);
  ids.runtimeToHandle.set(runtimeEntityId, handle);
}

export function resolveHandle(
  ids: EntityIdAllocator,
  handle: EntityHandle
): RuntimeEntityId | undefined {
  return ids.handleToRuntime.get(handleKey(handle));
}
