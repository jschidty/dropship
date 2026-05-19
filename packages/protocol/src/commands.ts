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

export type UnitOrderIntent =
  | Readonly<{
      type: "moveTo";
      target: Vec3Data;
    }>
  | Readonly<{
      type: "attackTarget";
      target: EntityHandle;
    }>
  | Readonly<{
      type: "capturePlanet";
      planet: EntityHandle;
    }>
  | Readonly<{
      type: "guardPlanet";
      planet: EntityHandle;
    }>
  | Readonly<{
      type: "escort";
      target: EntityHandle;
    }>;

export type IssueUnitOrderCommand = Readonly<{
  type: "issueUnitOrder";
  unitHandles: readonly EntityHandle[];
  order: UnitOrderIntent;
  queueMode: "replace" | "append";
}>;

export type CommandIntent =
  | RandomTurnOwnedUnitsCommand
  | MoveUnitsCommand
  | IssueUnitOrderCommand;

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
