import type { FormulaStep } from "./automation-types";

export function placeFormulaStep(steps: FormulaStep[], step: FormulaStep, editingIndex: number | null) {
  if (editingIndex !== null) {
    return steps.map((item, index) => index === editingIndex ? step : item);
  }
  const resultIndex = steps.findIndex((item) => item.result);
  if (resultIndex < 0) return [...steps, { ...step, result: true }];
  return [
    ...steps.slice(0, resultIndex),
    { ...step, result: false },
    ...steps.slice(resultIndex),
  ];
}
