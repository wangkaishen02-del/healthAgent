import type { RuntimePageCapabilities } from "./runtime-page-capabilities.ts";

export type RuntimeFieldOption = { value: string; label: string };
export type PageActionOptions = { operationId?: string };

export type RegisteredPageController = {
  setField: (fieldId: string, value: string) => Promise<unknown>;
  executeAction: (actionId: string, options?: PageActionOptions) => Promise<unknown>;
  executeRowAction: (actionId: string, row: number, options?: PageActionOptions) => Promise<unknown>;
  executeItemAction?: (actionId: string, itemId: string, options?: PageActionOptions) => Promise<unknown>;
  getRuntimeFieldOptions: () => Record<string, RuntimeFieldOption[]>;
  getRuntimeCapabilities?: () => RuntimePageCapabilities;
};
