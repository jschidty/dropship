import type { ContentRegistry } from "./registry";

export type ContentValidationResult = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

export function validateContentRegistry(
  registry: ContentRegistry
): ContentValidationResult {
  const errors: string[] = [];
  const seenTemplateIds = new Set<number>();
  const seenPlanetTemplateIds = new Set<number>();

  for (const template of registry.unitTemplates) {
    if (seenTemplateIds.has(template.id)) {
      errors.push(`Duplicate unit template id ${template.id}`);
    }

    seenTemplateIds.add(template.id);

    if (template.maxHealth <= 0) {
      errors.push(`Unit template ${template.slug} must have positive health`);
    }

    if (template.colliderRadius <= 0) {
      errors.push(`Unit template ${template.slug} must have a positive collider radius`);
    }
  }

  for (const template of registry.planetTemplates) {
    if (seenPlanetTemplateIds.has(template.id)) {
      errors.push(`Duplicate planet template id ${template.id}`);
    }

    seenPlanetTemplateIds.add(template.id);

    if (template.defaultMass <= 0) {
      errors.push(`Planet template ${template.slug} must have positive mass`);
    }

    if (template.defaultRadius <= 0) {
      errors.push(`Planet template ${template.slug} must have positive radius`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
