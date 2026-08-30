const calculationParameterBusinessOrder = ["LIMIT", "DEDUCTIBLE", "PAYMENT_RATIO"];
const calculationParameterOrderIndex = new Map(calculationParameterBusinessOrder.map((code, index) => [code, index]));

export function sortCalculationParameters<T extends { parameterCode: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftOrder = calculationParameterOrderIndex.get(left.parameterCode) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = calculationParameterOrderIndex.get(right.parameterCode) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.parameterCode.localeCompare(right.parameterCode, "zh-CN");
  });
}
