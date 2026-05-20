import {
  deriveShipStatsFromLoadout,
  type ContentRegistry,
} from "@drop-ship/content";
import {
  type CaptureRulesConfig,
  type MatchConfig,
  type MatchEndRulesConfig,
  type NpcRulesConfig,
  type PlayerControllerType,
  type PlayerId,
  type SimTuningConfig,
  type SpawningRulesConfig,
} from "@drop-ship/protocol";
import { validateShipComponentOverride } from "./shipStats";
import type { SimWorld } from "./world";

export function readSimTuning(world: SimWorld): SimTuningConfig {
  return world.config.tuning;
}

export function readCaptureRules(world: SimWorld): CaptureRulesConfig {
  return world.config.rules.capture;
}

export function readSpawningRules(world: SimWorld): SpawningRulesConfig {
  return world.config.rules.spawning;
}

export function readMatchEndRules(world: SimWorld): MatchEndRulesConfig {
  return world.config.rules.matchEnd;
}

export function readNpcRules(world: SimWorld): NpcRulesConfig {
  return world.config.rules.npc;
}

export function isPlayerControlledBy(
  world: SimWorld,
  playerId: PlayerId,
  controllerType: PlayerControllerType
): boolean {
  return world.config.controllers.some(
    (controller) =>
      controller.playerId === playerId && controller.type === controllerType
  );
}

export function validateResolvedMatchConfig(
  config: MatchConfig,
  content: ContentRegistry
): void {
  validateControllers(config);
  validateInitialUnitLoadouts(config, content);
  validateContentOverrides(config, content);
}

function validateControllers(config: MatchConfig): void {
  const players = new Set(config.players.map((player) => player.id));
  const controllers = new Set<PlayerId>();

  for (const controller of config.controllers) {
    if (!players.has(controller.playerId)) {
      throw new Error(
        `Controller references unknown player ${controller.playerId}`
      );
    }

    if (controllers.has(controller.playerId)) {
      throw new Error(
        `Player ${controller.playerId} has multiple controllers`
      );
    }

    controllers.add(controller.playerId);
  }

  for (const player of config.players) {
    if (!controllers.has(player.id)) {
      throw new Error(`Player ${player.id} is missing a controller`);
    }
  }
}

function validateInitialUnitLoadouts(
  config: MatchConfig,
  content: ContentRegistry
): void {
  for (const unit of config.initialUnits) {
    if (!unit.componentsBySlot) {
      continue;
    }

    const template = content.getUnitTemplate(unit.templateId);
    deriveShipStatsFromLoadout(
      template,
      unit.componentsBySlot,
      (componentId) => content.getShipComponent(componentId)
    );
  }
}

function validateContentOverrides(
  config: MatchConfig,
  content: ContentRegistry
): void {
  const overriddenComponents = new Set<number>();

  for (const override of config.contentOverrides?.shipComponents ?? []) {
    if (overriddenComponents.has(override.componentId)) {
      throw new Error(
        `Ship component ${override.componentId} has multiple stat overrides`
      );
    }

    overriddenComponents.add(override.componentId);
    validateShipComponentOverride(
      content.getShipComponent(override.componentId),
      override
    );
  }
}
