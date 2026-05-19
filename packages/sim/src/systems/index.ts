import { CaptureSystem } from "./capture";
import { CollisionSystem } from "./collision";
import { CombatSystem } from "./combat";
import { CommandIntakeSystem } from "./commandIntake";
import { DropShipSpawnSystem } from "./dropShipSpawn";
import { LifecycleSystem } from "./lifecycle";
import { MatchEndSystem } from "./matchEnd";
import { PhysicsSystem, SteeringSystem } from "./motion";
import { NpcCommandSystem } from "./npcCommand";
import { PlanetMotionSystem } from "./planetMotion";
import {
  EventFlushSystem,
  FleetCommandSystem,
  MiningSystem,
  ResourceSystem,
} from "./placeholders";
import { ShipOrderSystem } from "./shipOrder";
import type { SimSystem } from "../world";

export * from "./capture";
export * from "./collision";
export * from "./combat";
export * from "./commandIntake";
export * from "./dropShipSpawn";
export * from "./lifecycle";
export * from "./matchEnd";
export * from "./motion";
export * from "./npcCommand";
export * from "./planetMotion";
export * from "./placeholders";
export * from "./shipOrder";

export const PHASE_ONE_SYSTEMS: readonly SimSystem[] = [
  PlanetMotionSystem,
  CommandIntakeSystem,
  NpcCommandSystem,
  FleetCommandSystem,
  ShipOrderSystem,
  SteeringSystem,
  PhysicsSystem,
  CollisionSystem,
  CombatSystem,
  CaptureSystem,
  DropShipSpawnSystem,
  MiningSystem,
  ResourceSystem,
  LifecycleSystem,
  MatchEndSystem,
  EventFlushSystem,
];
