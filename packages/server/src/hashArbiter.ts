import type { DesyncMessage, HashMessage, PlayerId } from "@drop-ship/protocol";

export type HashArbiter = {
  record: (message: HashMessage) => DesyncMessage | null;
  readTick: (tick: number) => readonly HashMessage[];
};

export function createHashArbiter(expectedPlayers: readonly PlayerId[]): HashArbiter {
  const reportsByTick = new Map<number, HashMessage[]>();

  return {
    record(message) {
      const reports = reportsByTick.get(message.tick) ?? [];
      const withoutPreviousForPlayer = reports.filter(
        (report) => report.playerId !== message.playerId
      );
      const nextReports = [...withoutPreviousForPlayer, message].sort(
        (a, b) => a.playerId - b.playerId
      );
      reportsByTick.set(message.tick, nextReports);

      if (nextReports.length < expectedPlayers.length) {
        return null;
      }

      const uniqueHashes = new Set(nextReports.map((report) => report.hash));

      if (uniqueHashes.size <= 1) {
        return null;
      }

      return {
        type: "desync",
        tick: message.tick,
        hashes: nextReports,
      };
    },
    readTick(tick) {
      return reportsByTick.get(tick) ?? [];
    },
  };
}
