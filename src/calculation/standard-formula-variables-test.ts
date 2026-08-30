import assert from "node:assert/strict";
import { buildStandardFormulaConfigurationVariables } from "./standard-formula-variables";
import type { CalculationParameterDefinition } from "../underwriting/types";

const definitions: CalculationParameterDefinition[] = [
  { parameterCode: "PAYMENT_RATIO", parameterName: "赔付比例", valueType: "percentage", unit: "%", applicableScopes: ["benefit", "policy", "product", "plan"] },
  { parameterCode: "DEDUCTIBLE", parameterName: "免赔额", valueType: "amount", unit: "元", applicableScopes: ["product", "benefit", "plan", "policy"] },
  { parameterCode: "LIMIT", parameterName: "限额", valueType: "amount", unit: "元", applicableScopes: ["benefit", "product", "policy", "plan"] },
];

const variables = buildStandardFormulaConfigurationVariables(definitions, "policy-test");
assert.deepEqual(variables.map((item) => item.formulaName), [
  "限额（保单）", "限额（保障计划）", "限额（险种）", "限额（责任）",
  "免赔额（保单）", "免赔额（保障计划）", "免赔额（险种）", "免赔额（责任）",
  "赔付比例（保单）", "赔付比例（保障计划）", "赔付比例（险种）", "赔付比例（责任）",
]);
assert.equal(variables.every((item) => item.defaultValue === undefined), true);
assert.equal(variables.every((item) => item.policyId === "policy-test"), true);

console.log("standard-formula-variables-test: ok");
