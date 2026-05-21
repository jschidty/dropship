import type {
  MatchEndMessage,
  MatchEndReportMessage,
  PlayerId,
} from "@drop-ship/protocol";

export type MatchEndReport = MatchEndReportMessage;

export type MatchEndAgreement = MatchEndMessage &
  Readonly<{
    reports: readonly MatchEndReport[];
  }>;

export type MatchEndStore = {
  record: (report: MatchEndReportMessage) => Promise<MatchEndMessage | null>;
  readAgreement: () => Promise<MatchEndMessage | null>;
  listReports: () => Promise<readonly MatchEndReport[]>;
};

const MATCH_END_AGREEMENT_KEY = "matchEnd:agreement";
const MATCH_END_REPORT_PREFIX = "matchEndReport:";

export function createMatchEndStore(
  storage?: DurableObjectStorage
): MatchEndStore {
  const reportsByPlayer = new Map<PlayerId, MatchEndReport>();
  let agreement: MatchEndMessage | null = null;
  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) {
      return;
    }

    loaded = true;
    agreement =
      (await storage?.get<MatchEndMessage>(MATCH_END_AGREEMENT_KEY)) ?? null;

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

      if (agreement) {
        return agreement;
      }

      reportsByPlayer.set(report.playerId, report);
      await storage?.put(matchEndReportKey(report.playerId), report);

      const resolved = resolveMatchEndAgreement([...reportsByPlayer.values()]);

      if (!resolved) {
        return null;
      }

      agreement = {
        type: "matchEnd",
        tick: resolved.tick,
        winner: resolved.winner,
        finalHash: resolved.finalHash,
      };
      await storage?.put(MATCH_END_AGREEMENT_KEY, agreement);
      return agreement;
    },
    async readAgreement() {
      await load();
      return agreement;
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
  }>
): MatchEndReport {
  return {
    type: "matchEndReport",
    playerId: options.playerId,
    tick: options.tick,
    winner: options.winner,
    finalHash: options.finalHash,
  };
}

export function resolveMatchEndAgreement(
  reports: readonly MatchEndReport[]
): MatchEndAgreement | null {
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
      report.finalHash === first.finalHash
  );

  if (!agreed) {
    return null;
  }

  return {
    type: "matchEnd",
    tick: first.tick,
    winner: first.winner,
    finalHash: first.finalHash,
    reports: orderedReports,
  };
}
