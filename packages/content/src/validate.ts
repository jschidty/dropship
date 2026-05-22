import type { ContentRegistry } from "./registry";

export type ContentValidationResult = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

export function validateContentRegistry(
  registry: ContentRegistry
): ContentValidationResult {
  const errors: string[] = [];
  const seenComponentIds = new Set<number>();
  const seenTemplateIds = new Set<number>();
  const seenPlanetTemplateIds = new Set<number>();

  for (const component of registry.shipComponents) {
    if (seenComponentIds.has(component.id)) {
      errors.push(`Duplicate ship component id ${component.id}`);
    }

    seenComponentIds.add(component.id);

    if (component.mass < 0) {
      errors.push(`Ship component ${component.slug} must not have negative mass`);
    }

    if (component.powerDraw < 0) {
      errors.push(`Ship component ${component.slug} must not have negative power draw`);
    }

    if (
      component.type === "weapon" &&
      (component.minRange ?? 0) > component.range
    ) {
      errors.push(
        `Ship component ${component.slug} must not have min range greater than range`
      );
    }
  }

  for (const template of registry.unitTemplates) {
    if (seenTemplateIds.has(template.id)) {
      errors.push(`Duplicate unit template id ${template.id}`);
    }

    seenTemplateIds.add(template.id);

    if (template.hull.maxHealth <= 0) {
      errors.push(`Unit template ${template.slug} must have positive health`);
    }

    if (template.shipClassId <= 0) {
      errors.push(`Unit template ${template.slug} must have a positive ship class`);
    }

    if (template.hull.colliderRadius <= 0) {
      errors.push(`Unit template ${template.slug} must have a positive collider radius`);
    }

    if (template.hull.baseMass <= 0) {
      errors.push(`Unit template ${template.slug} must have positive base mass`);
    }

    const slotIds = new Set<string>();

    for (const slot of template.slots) {
      if (slotIds.has(slot.id)) {
        errors.push(`Unit template ${template.slug} has duplicate slot ${slot.id}`);
      }

      slotIds.add(slot.id);
    }

    for (const slotId of Object.keys(template.defaultLoadout.componentsBySlot)) {
      if (!slotIds.has(slotId)) {
        errors.push(
          `Unit template ${template.slug} loadout references unknown slot ${slotId}`
        );
      }
    }

    if (template.stats.dryMass <= 0) {
      errors.push(`Unit template ${template.slug} must have positive dry mass`);
    }

    if (template.stats.maxSpeed < 0 || template.stats.maxAcceleration < 0) {
      errors.push(`Unit template ${template.slug} must not have negative mobility stats`);
    }

    if (template.stats.powerAvailable < 0) {
      errors.push(`Unit template ${template.slug} loadout exceeds available power`);
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
