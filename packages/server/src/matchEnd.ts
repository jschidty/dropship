import type {
  MatchEndMessage,
  MatchEndReportMessage,
  MatchEndReportSummary,
  PlayerId,
} from "@drop-ship/protocol";

export type MatchEndReport = MatchEndReportMessage;

export type MatchEndAgreement = MatchEndMessage &
  Readonly<{
    reports: readonly MatchEndReport[];
  }>;

export type MatchEndStore = {
  record: (report: MatchEndReportMessage) => Promise<MatchEndMessage | null>;
  recordTrusted: (report: MatchEndReportMessage) => Promise<MatchEndMessage>;
  readFinal: () => Promise<MatchEndMessage | null>;
  readAgreement: () => Promise<MatchEndMessage | null>;
  listReports: () => Promise<readonly MatchEndReport[]>;
};

const MATCH_END_FINAL_KEY = "matchEnd:final";
const LEGACY_MATCH_END_AGREEMENT_KEY = "matchEnd:agreement";
const MATCH_END_REPORT_PREFIX = "matchEndReport:";

export function createMatchEndStore(
  storage?: DurableObjectStorage
): MatchEndStore {
  const reportsByPlayer = new Map<PlayerId, MatchEndReport>();
  let final: MatchEndMessage | null = null;
  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) {
      return;
    }

    loaded = true;
    final =
      (await storage?.get<MatchEndMessage>(MATCH_END_FINAL_KEY)) ??
      (await storage?.get<MatchEndMessage>(LEGACY_MATCH_END_AGREEMENT_KEY)) ??
      null;

    const stored = await storage?.list<MatchEndReport>({
      prefix: MATCH_END_REPORT_PREFIX,
    });

    for (const report of stored?.values() ?? []) {
      reportsByPlayer.set(report.playerId, report);
    }
  }

  return {
    async record(report) {
      await load();

      if (final) {
        return final;
      }

      reportsByPlayer.set(report.playerId, report);
      await storage?.put(matchEndReportKey(report.playerId), report);

      const resolved = resolveMatchEndFinal([...reportsByPlayer.values()]);

      if (!resolved) {
        return null;
      }

      final = resolved;
      await storage?.put(MATCH_END_FINAL_KEY, final);
      return final;
    },
    async recordTrusted(report) {
      await load();

      if (final) {
        return final;
      }

      reportsByPlayer.set(report.playerId, report);
      await storage?.put(matchEndReportKey(report.playerId), report);

      final = createMatchEndMessage("trusted", [report]);
      await storage?.put(MATCH_END_FINAL_KEY, final);
      return final;
    },
    async readFinal() {
      await load();
      return final;
    },
    async readAgreement() {
      await load();
      return final?.source === "agreed" ? final : null;
    },
    async listReports() {
      await load();
      return [...reportsByPlayer.values()].sort(
        (a, b) => a.playerId - b.playerId
      );
    },
  };
}

export function matchEndReportKey(playerId: PlayerId): string {
  return `${MATCH_END_REPORT_PREFIX}${playerId}`;
}

export function createMatchEndReport(
  options: Readonly<{
    playerId: PlayerId;
    tick: number;
    winner: PlayerId | 0;
    finalHash: string;
    reason: MatchEndReport["reason"];
  }>
): MatchEndReport {
  return {
    type: "matchEndReport",
    playerId: options.playerId,
    tick: options.tick,
    winner: options.winner,
    reason: options.reason,
    finalHash: options.finalHash,
  };
}

export function resolveMatchEndFinal(
  reports: readonly MatchEndReport[]
): MatchEndMessage | null {
  const uniquePlayers = new Set(reports.map((report) => report.playerId));

  if (uniquePlayers.size < 2) {
    return null;
  }

  const orderedReports = reports.slice().sort((a, b) => a.playerId - b.playerId);
  const [first, ...rest] = orderedReports;
  const agreed = rest.every(
    (report) =>
      report.tick === first.tick &&
      report.winner === first.winner &&
      report.reason === first.reason &&
      report.finalHash === first.finalHash
  );

  return createMatchEndMessage(agreed ? "agreed" : "conflict", orderedReports);
}

export function resolveMatchEndAgreement(
  reports: readonly MatchEndReport[]
): MatchEndAgreement | null {
  const final = resolveMatchEndFinal(reports);

  if (!final || final.source !== "agreed" || !final.reports) {
    return null;
  }

  return {
    ...final,
    reports: final.reports.map(reportSummaryToReport),
  };
}

function createMatchEndMessage(
  source: MatchEndMessage["source"],
  reports: readonly MatchEndReport[]
): MatchEndMessage {
  const orderedReports = reports.slice().sort((a, b) => a.playerId - b.playerId);
  const [first] = orderedReports;

  if (!first) {
    throw new Error("Cannot create match end without reports");
  }

  const summary = orderedReports.map(reportToSummary);

  if (source === "conflict") {
    return {
      type: "matchEnd",
      tick: Math.max(...orderedReports.map((report) => report.tick)),
      winner: 0,
      reason: "desync",
      finalHash: null,
      source,
      reports: summary,
    };
  }

  return {
    type: "matchEnd",
    tick: first.tick,
    winner: first.winner,
    reason: first.reason,
    finalHash: first.finalHash,
    source,
    reports: summary,
  };
}

function reportToSummary(report: MatchEndReport): MatchEndReportSummary {
  return {
    playerId: report.playerId,
    tick: report.tick,
    winner: report.winner,
    reason: report.reason,
    finalHash: report.finalHash,
  };
}

function reportSummaryToReport(summary: MatchEndReportSummary): MatchEndReport {
  return {
    type: "matchEndReport",
    ...summary,
  };
}
