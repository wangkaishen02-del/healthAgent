import type { CalculationVariableView } from "./automation-types";
import type { CalculationParameterDefinition, CalculationParameterScope } from "../underwriting/types";
import { sortCalculationParameters } from "../underwriting/calculation-parameter-order";

const parameterScopeOrder: CalculationParameterScope[] = ["policy", "plan", "product", "benefit"];
const parameterScopeLabels: Record<CalculationParameterScope, string> = {
  policy: "保单",
  plan: "保障计划",
  product: "险种",
  benefit: "责任",
};

export function buildStandardFormulaConfigurationVariables(
  definitions: CalculationParameterDefinition[],
  policyId = "",
): CalculationVariableView[] {
  return sortCalculationParameters(definitions).flatMap((definition) =>
    parameterScopeOrder
      .filter((scope) => definition.applicableScopes.includes(scope))
      .map((scope) => ({
        parameterCode: definition.parameterCode,
        policyId,
        category: "benefit" as const,
        variableName: definition.parameterName,
        formulaName: `${definition.parameterName}（${parameterScopeLabels[scope]}）`,
        parameterScope: scope,
        valueType: definition.valueType,
        unit: definition.unit,
        description: definition.description,
        custom: false,
        enabled: true,
      })),
  );
}
