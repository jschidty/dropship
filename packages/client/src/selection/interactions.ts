export type SceneSelectionKind = "friendlyUnit" | "enemyUnit" | "planet";

export type SceneSelectionTarget = Readonly<{
  kind: SceneSelectionKind;
  key: string;
}>;

export type SceneSelectionCandidate = SceneSelectionTarget &
  Readonly<{
    screenDistancePx: number;
    screenScore: number;
    handleId?: number;
  }>;

export function readSceneSelectionKindPriority(
  kind: SceneSelectionKind
): number {
  switch (kind) {
    case "friendlyUnit":
      return 0;
    case "enemyUnit":
      return 1;
    case "planet":
      return 2;
  }
}

export function compareSceneSelectionCandidates(
  first: SceneSelectionCandidate,
  second: SceneSelectionCandidate
): number {
  return (
    readSceneSelectionKindPriority(first.kind) -
      readSceneSelectionKindPriority(second.kind) ||
    first.screenScore - second.screenScore ||
    first.screenDistancePx - second.screenDistancePx ||
    (first.handleId ?? Number.MAX_SAFE_INTEGER) -
      (second.handleId ?? Number.MAX_SAFE_INTEGER) ||
    first.key.localeCompare(second.key)
  );
}

export function selectPrimarySceneSelectionCandidate<
  Candidate extends SceneSelectionCandidate,
>(candidates: readonly Candidate[]): Candidate | null {
  return candidates.slice().sort(compareSceneSelectionCandidates)[0] ?? null;
}

export function rankSceneSelectionCandidates<
  Candidate extends SceneSelectionCandidate,
>(candidates: readonly Candidate[]): readonly Candidate[] {
  return candidates.slice().sort(compareSceneSelectionCandidates);
}

export function selectNextSceneSelectionTarget(
  candidates: readonly SceneSelectionCandidate[],
  currentTarget: SceneSelectionTarget | null,
  direction: 1 | -1
): SceneSelectionTarget | null {
  const ranked = rankSceneSelectionCandidates(candidates);

  if (ranked.length === 0) {
    return null;
  }

  const currentIndex = currentTarget
    ? ranked.findIndex((candidate) =>
        areSceneSelectionTargetsEqual(candidate, currentTarget)
      )
    : -1;

  const nextCandidate =
    currentIndex < 0
      ? direction > 0
        ? ranked[0]
        : ranked[ranked.length - 1]
      : ranked[(currentIndex + direction + ranked.length) % ranked.length];

  return toSceneSelectionTarget(nextCandidate);
}

export function toSceneSelectionTarget(
  candidate: SceneSelectionCandidate
): SceneSelectionTarget {
  return {
    kind: candidate.kind,
    key: candidate.key,
  };
}

export function areSceneSelectionTargetsEqual(
  first: SceneSelectionTarget | null,
  second: SceneSelectionTarget | null
): boolean {
  return first?.kind === second?.kind && first?.key === second?.key;
}
