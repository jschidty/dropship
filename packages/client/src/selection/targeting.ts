import { SHIP_CLASS_IDS } from "@drop-ship/protocol";

export type AttackTargetCandidate = Readonly<{
  key: string;
  shipClassId: number;
  screenDistancePx: number;
  worldDistance: number;
  handleId: number;
}>;

export function readAttackTargetPriority(shipClassId: number): number {
  if (shipClassId === SHIP_CLASS_IDS.dropShip) {
    return 0;
  }

  if (shipClassId === SHIP_CLASS_IDS.battleship) {
    return 1;
  }

  if (shipClassId === SHIP_CLASS_IDS.fighter) {
    return 2;
  }

  return 3;
}

export function compareAttackTargetCandidates(
  first: AttackTargetCandidate,
  second: AttackTargetCandidate
): number {
  return (
    readAttackTargetPriority(first.shipClassId) -
      readAttackTargetPriority(second.shipClassId) ||
    first.screenDistancePx - second.screenDistancePx ||
    first.worldDistance - second.worldDistance ||
    first.handleId - second.handleId ||
    first.key.localeCompare(second.key)
  );
}

export function rankAttackTargetCandidates(
  candidates: readonly AttackTargetCandidate[]
): readonly AttackTargetCandidate[] {
  return candidates.slice().sort(compareAttackTargetCandidates);
}

export function selectNextAttackTargetKey(
  candidates: readonly AttackTargetCandidate[],
  currentKey: string | null,
  direction: 1 | -1
): string | null {
  const ranked = rankAttackTargetCandidates(candidates);

  if (ranked.length === 0) {
    return null;
  }

  const currentIndex = currentKey
    ? ranked.findIndex((candidate) => candidate.key === currentKey)
    : -1;

  if (currentIndex < 0) {
    return direction > 0
      ? ranked[0].key
      : ranked[ranked.length - 1].key;
  }

  return ranked[
    (currentIndex + direction + ranked.length) % ranked.length
  ].key;
}
