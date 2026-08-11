import type { PageRegistration, RegisteredRegion } from "./page-registry.ts";

export type RuntimePageCapabilities = {
  availableActionIds?: string[];
  unavailableActionIds?: string[];
  availableFieldIds?: string[];
  unavailableFieldIds?: string[];
};

function allows(
  id: string,
  available: string[] | undefined,
  unavailable: string[] | undefined,
) {
  if (available && !available.includes(id)) return false;
  return !unavailable?.includes(id);
}

export function applyRuntimePageCapabilities(
  registry: unknown,
  capabilities?: RuntimePageCapabilities,
) {
  if (!capabilities || !registry || typeof registry !== "object") return registry;
  const activeCapabilities = capabilities;
  const page = registry as PageRegistration;
  if (!Array.isArray(page.regions)) return registry;

  function filterRegions(regions: RegisteredRegion[]): RegisteredRegion[] {
    return regions.map((region) => ({
      ...region,
      fields: region.fields?.filter((field) => allows(
        field.fieldId,
        activeCapabilities.availableFieldIds,
        activeCapabilities.unavailableFieldIds,
      )),
      actions: region.actions?.filter((action) => allows(
        action.actionId,
        activeCapabilities.availableActionIds,
        activeCapabilities.unavailableActionIds,
      )),
      children: region.children ? filterRegions(region.children) : undefined,
    }));
  }

  return { ...page, regions: filterRegions(page.regions) };
}
