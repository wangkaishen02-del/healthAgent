export type CalculationVariableCategory = "bill" | "event" | "ledger" | "benefit" | "custom";
export type AutomationValueType = "number" | "amount" | "percentage" | "text" | "boolean" | "date";

export type FormulaLedgerTarget = {
  code: string;
  name: string;
};

export type FormulaStep = {
  id: string;
  name: string;
  expression: string;
  result: boolean;
  ledgerTarget?: FormulaLedgerTarget;
};

export type FormulaValidationStep = {
  id: string;
  name: string;
  expression: string;
  substitutedExpression: string;
  value: number | boolean | string;
  result: boolean;
};

export type FormulaValidationResult = {
  matched: boolean;
  matchExpression: string;
  substitutedMatchExpression: string;
  steps: FormulaValidationStep[];
  result?: number | boolean | string;
};

export type BenefitFormulaView = {
  id?: number;
  policyId: string;
  benefitId: string;
  benefitCode: string;
  benefitName: string;
  formulaName: string;
  matchExpression: string;
  steps: FormulaStep[];
  enabled: boolean;
  standardFormulaId?: number;
  standardFormulaCode?: string;
  updatedAt?: string;
};

export type StandardFormulaView = {
  id: number;
  formulaCode: string;
  formulaName: string;
  matchExpression: string;
  steps: FormulaStep[];
  tags: string[];
  referenceCount: number;
  sourcePolicyId?: string;
  sourceBenefitId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalculationVariableView = {
  id?: number;
  parameterCode?: string;
  policyId: string;
  category: CalculationVariableCategory;
  variableName: string;
  formulaName?: string;
  benefitId?: string;
  parameterScope?: "policy" | "plan" | "product" | "benefit";
  valueType: AutomationValueType;
  unit?: string;
  timeRange?: "year" | "month" | "day";
  responsibilityRange?: "benefit" | "product" | "plan" | "event";
  defaultValue?: string;
  description?: string;
  dictionaryType?: string;
  options?: string[];
  custom: boolean;
  enabled: boolean;
};

export type AutomatedBillView = {
  id: string;
  claimCaseId: string;
  attachmentIds: string[];
  selectedBenefitIds: string[];
  customValues: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type LedgerBalanceView = {
  id: string;
  policyId: string;
  insuredPersonId: string;
  benefitId: string;
  ledgerCode: string;
  ledgerName: string;
  periodYear: number;
  currentAmount: number;
  configuredAmount?: number;
  remainingAmount?: number;
};

export type CalculationStepResult = FormulaStep & {
  substitutedExpression?: string;
  value: number | boolean | string;
  ledgerOpening?: number;
  ledgerClosing?: number;
};

export type BillBenefitCalculationResult = {
  billId: string;
  invoiceNo: string;
  benefitId: string;
  benefitCode: string;
  benefitName: string;
  formulaName: string;
  matched?: boolean;
  matchExpression?: string;
  substitutedMatchExpression?: string;
  amount: number;
  steps: CalculationStepResult[];
};

export type AutomaticCalculationResult = {
  runId: string;
  runNo: string;
  claimCaseId: string;
  committed: boolean;
  totalAmount: number;
  billCount?: number;
  responsibilityResultCount?: number;
  billResults: BillBenefitCalculationResult[];
  ledgerBalances: LedgerBalanceView[];
  createdAt: string;
};
