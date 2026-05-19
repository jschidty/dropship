const INITIAL_INSTANCE_CAPACITY = 64;

export function nextInstanceCapacity(requiredCount: number): number {
  let capacity = INITIAL_INSTANCE_CAPACITY;

  while (capacity < requiredCount) {
    capacity *= 2;
  }

  return capacity;
}
