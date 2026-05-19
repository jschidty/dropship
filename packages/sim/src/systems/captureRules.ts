import {
  DEFAULT_CAPTURE_DEMO_RULES,
  type CaptureDemoRules,
} from "@drop-ship/protocol";
import type { SimWorld } from "../world";

export function readCaptureDemoRules(world: SimWorld): CaptureDemoRules {
  return world.config.captureDemoRules ?? DEFAULT_CAPTURE_DEMO_RULES;
}
