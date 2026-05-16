import type { EntityHandle, PlayerId } from "./handles";
import type { Vec3Data } from "./matchConfig";

export type RandomTurnOwnedUnitsCommand = Readonly<{
  type: "randomTurnOwnedUnits";
}>;

export type MoveUnitsCommand = Readonly<{
  type: "moveUnits";
  unitHandles: readonly EntityHandle[];
  target: Vec3Data;
}>;

export type CommandIntent = RandomTurnOwnedUnitsCommand | MoveUnitsCommand;

export type ScheduledCommand = Readonly<{
  playerId: PlayerId;
  clientSeq: number;
  command: CommandIntent;
}>;

export type CommandBatch = Readonly<{
  tick: number;
  commands: readonly ScheduledCommand[];
}>;

export function createEmptyCommandBatch(tick: number): CommandBatch {
  return {
    tick,
    commands: [],
  };
}
