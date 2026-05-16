import type { CommandBatch, CommandIntent } from "./commands";
import type { PlayerId } from "./handles";
import type { MatchConfig } from "./matchConfig";
import type { CompactSimSnapshot } from "./snapshot";

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

export type ClientMessage =
  | ReadyMessage
  | CommandMessage
  | HashMessage
  | SnapshotMessage;

export type MatchStartMessage = Readonly<{
  type: "matchStart";
  playerId: PlayerId;
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

export type ConnectionStatusMessage = Readonly<{
  type: "connectionStatus";
  serverTick: number;
  running: boolean;
  players: readonly Readonly<{
    playerId: PlayerId;
    connected: boolean;
  }>[];
}>;

export type ServerMessage =
  | MatchStartMessage
  | TickCommandsMessage
  | CommandAckMessage
  | DesyncMessage
  | ResyncHardMessage
  | ConnectionStatusMessage;
