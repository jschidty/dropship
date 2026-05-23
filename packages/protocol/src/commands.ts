import type { EntityHandle, PlayerId } from "./handles";
import type { Vec3Data } from "./matchConfig";

export type CommandSource = "player" | "npc" | "autonomy" | "system";

export type RandomTurnOwnedUnitsCommand = Readonly<{
  type: "randomTurnOwnedUnits";
}>;

export type MoveUnitsCommand = Readonly<{
  type: "moveUnits";
  unitHandles: readonly EntityHandle[];
  target: Vec3Data;
}>;

export type OrbitLaneSpec = Readonly<{
  radius: number;
  axis: Vec3Data;
  direction: -1 | 1;
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
      lane?: OrbitLaneSpec;
    }>
  | Readonly<{
      type: "guardPlanet";
      planet: EntityHandle;
      lane?: OrbitLaneSpec;
    }>
  | Readonly<{
      type: "orbitPlanet";
      planet: EntityHandle;
      lane?: OrbitLaneSpec;
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
  source?: CommandSource;
  command: CommandIntent;
}>;

export type CommandBatch = Readonly<{
  tick: number;
  commands: readonly ScheduledCommand[];
}>;

export function compareScheduledCommands(
  left: ScheduledCommand,
  right: ScheduledCommand
): number {
  if (left.playerId !== right.playerId) {
    return left.playerId - right.playerId;
  }

  const sourcePriority =
    readCommandSourcePriority(left) - readCommandSourcePriority(right);

  return sourcePriority !== 0 ? sourcePriority : left.clientSeq - right.clientSeq;
}

export function createEmptyCommandBatch(tick: number): CommandBatch {
  return {
    tick,
    commands: [],
  };
}

function readCommandSourcePriority(command: ScheduledCommand): number {
  return (command.source ?? "player") === "player" ? 1 : 0;
}
