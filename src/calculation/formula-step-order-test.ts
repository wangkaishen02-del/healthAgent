import assert from "node:assert/strict";
import { calculationExpressionReferencesAny } from "./expression-engine";
import { placeFormulaStep } from "./formula-step-order";
import type { FormulaStep } from "./automation-types";

const existing: FormulaStep[] = [
  { id: "1", name: "责任剩余限额", expression: "限额（责任） - 累计年给付金额（责任）", result: false },
  { id: "2", name: "计划剩余限额", expression: "限额（保障计划） - 累计年给付金额（计划）", result: false },
  { id: "3", name: "给付金额", expression: "取小 ( 剩余限额 , 理算金额 )", result: true },
];
const inserted = placeFormulaStep(existing, {
  id: "4",
  name: "剩余限额",
  expression: "取小 ( 责任剩余限额 , 计划剩余限额 )",
  result: false,
}, null);

assert.deepEqual(inserted.map((step) => step.name), ["责任剩余限额", "计划剩余限额", "剩余限额", "给付金额"]);
assert.deepEqual(inserted.map((step) => step.result), [false, false, false, true]);
inserted.forEach((step, index) => {
  assert.equal(
    calculationExpressionReferencesAny(step.expression, inserted.slice(index + 1).map((candidate) => candidate.name)),
    false,
  );
});

const first = placeFormulaStep([], { id: "1", name: "给付金额", expression: "医疗总费用", result: false }, null);
assert.equal(first[0].result, true);

console.log("formula-step-order-test: ok");
