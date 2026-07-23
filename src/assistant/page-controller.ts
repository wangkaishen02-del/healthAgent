export type RuntimeFieldOption = { value: string; label: string };

export type RegisteredPageController = {
  setField: (fieldId: string, value: string) => Promise<unknown>;
  executeAction: (actionId: string) => Promise<unknown>;
  executeRowAction: (actionId: string, row: number) => Promise<unknown>;
  executeItemAction?: (actionId: string, itemId: string) => Promise<unknown>;
  getRuntimeFieldOptions: () => Record<string, RuntimeFieldOption[]>;
};
