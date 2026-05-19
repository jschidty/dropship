import type { PlayerId } from "@drop-ship/protocol";
import type { UnitViewModel } from "../types";

export function selectMoveOrderUnits(
  units: readonly UnitViewModel[],
  playerId: PlayerId,
  selectedUnitKeys: ReadonlySet<string>,
  leaderKey: string | null
): readonly UnitViewModel[] {
  const selectedUnits = units.filter(
    (unit) => unit.owner === playerId && selectedUnitKeys.has(unit.key)
  );

  if (selectedUnits.length === 0) {
    return [];
  }

  const leader = leaderKey
    ? selectedUnits.find((unit) => unit.key === leaderKey)
    : null;

  return leader ? [leader] : selectedUnits;
}
