export type PlayerId = 1 | 2;

export type EntityHandle = Readonly<{
  id: number;
  generation: number;
}>;

export type StableHandleKey = `${number}:${number}`;

export const PHASE_ONE_PLAYER_IDS = [1, 2] as const satisfies readonly PlayerId[];

export function handleKey(handle: EntityHandle): StableHandleKey {
  return `${handle.id}:${handle.generation}`;
}

export function sameHandle(a: EntityHandle, b: EntityHandle): boolean {
  return a.id === b.id && a.generation === b.generation;
}

export function compareHandles(a: EntityHandle, b: EntityHandle): number {
  return a.id === b.id ? a.generation - b.generation : a.id - b.id;
}
