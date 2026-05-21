import type { CommandBatch, CommandIntent } from "./commands";
import type { PlayerId } from "./handles";
import type { MatchConfig, MatchEndReason } from "./matchConfig";
import type { CompactSimSnapshot } from "./snapshot";

export type MatchSessionRole = "player1" | "player2" | "spectator";

export type ReadyMessage = Readonly<{
  type: "ready";
  playerId: PlayerId;
}>;

export type CommandMessage = Readonly<{
  type: "command";
  playerId: PlayerId;
  clientSeq: number;
  localTick: number;
  command: CommandIntent;
}>;

export type HashMessage = Readonly<{
  type: "hash";
  playerId: PlayerId;
  tick: number;
  hash: string;
}>;

export type SnapshotMessage = Readonly<{
  type: "snapshot";
  playerId: PlayerId;
  tick: number;
  snapshot: CompactSimSnapshot;
}>;

export type ReconnectMessage = Readonly<{
  type: "reconnect";
  playerId: PlayerId;
  lastTick: number;
}>;

export type MatchEndReportMessage = Readonly<{
  type: "matchEndReport";
  playerId: PlayerId;
  tick: number;
  winner: PlayerId | 0;
  reason: MatchEndReason;
  finalHash: string;
}>;

export type ReplayMessage = Readonly<{
  type: "replay";
  playerId: PlayerId;
}>;

export type ClientMessage =
  | ReadyMessage
  | CommandMessage
  | HashMessage
  | SnapshotMessage
  | ReconnectMessage
  | MatchEndReportMessage
  | ReplayMessage;

export type MatchStartMessage = Readonly<{
  type: "matchStart";
  playerId: PlayerId;
  role: MatchSessionRole;
  canControl: boolean;
  seatToken?: string;
  serverTick: number;
  config: MatchConfig;
  initialState?: CompactSimSnapshot;
}>;

export type TickCommandsMessage = Readonly<{
  type: "tickCommands";
  batch: CommandBatch;
}>;

export type CommandAckMessage = Readonly<{
  type: "commandAck";
  clientSeq: number;
  executeTick: number;
}>;

export type DesyncMessage = Readonly<{
  type: "desync";
  tick: number;
  hashes: readonly HashMessage[];
}>;

export type ResyncHardMessage = Readonly<{
  type: "resyncHard";
  tick: number;
  snapshot: CompactSimSnapshot;
}>;

export type CatchupMessage = Readonly<{
  type: "catchup";
  serverTick: number;
  snapshotTick: number;
  snapshot: CompactSimSnapshot | null;
  commands: readonly CommandBatch[];
}>;

export type ConnectionStatusMessage = Readonly<{
  type: "connectionStatus";
  serverTick: number;
  running: boolean;
  spectatorCount?: number;
  players: readonly Readonly<{
    playerId: PlayerId;
    connected: boolean;
    ready?: boolean;
  }>[];
}>;

export type MatchEndSource = "agreed" | "trusted" | "conflict";

export type MatchEndReportSummary = Readonly<{
  playerId: PlayerId;
  tick: number;
  winner: PlayerId | 0;
  reason: MatchEndReason;
  finalHash: string;
}>;

export type MatchRatingDelta = Readonly<{
  playerId: PlayerId;
  ratingBefore: number;
  ratingAfter: number;
}>;

export type MatchEndMessage = Readonly<{
  type: "matchEnd";
  tick: number;
  winner: PlayerId | 0;
  reason: MatchEndReason;
  finalHash: string | null;
  source: MatchEndSource;
  reports?: readonly MatchEndReportSummary[];
  ratingDeltas?: readonly MatchRatingDelta[];
}>;

export type ServerMessage =
  | MatchStartMessage
  | TickCommandsMessage
  | CommandAckMessage
  | DesyncMessage
  | ResyncHardMessage
  | CatchupMessage
  | ConnectionStatusMessage
  | MatchEndMessage;
