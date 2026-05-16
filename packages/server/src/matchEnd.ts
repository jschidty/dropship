import type { PlayerId } from "@drop-ship/protocol";

export type MatchEndReport = Readonly<{
  playerId: PlayerId;
  tick: number;
  winner: PlayerId | "draw";
  finalHash: string;
}>;

export type MatchEndAgreement = Readonly<{
  tick: number;
  winner: PlayerId | "draw";
  finalHash: string;
  reports: readonly MatchEndReport[];
}>;

export function resolveMatchEndAgreement(
  reports: readonly MatchEndReport[]
): MatchEndAgreement | null {
  if (reports.length < 2) {
    return null;
  }

  const [first, ...rest] = reports;
  const agreed = rest.every(
    (report) =>
      report.tick === first.tick &&
      report.winner === first.winner &&
      report.finalHash === first.finalHash
  );

  if (!agreed) {
    return null;
  }

  return {
    tick: first.tick,
    winner: first.winner,
    finalHash: first.finalHash,
    reports: reports.slice().sort((a, b) => a.playerId - b.playerId),
  };
}
