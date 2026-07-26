export type CalculationVariableCategory = "bill" | "event" | "case" | "ledger" | "benefit" | "custom";
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
  updatedAt?: string;
};

export type CalculationVariableView = {
  id?: number;
  policyId: string;
  category: CalculationVariableCategory;
  variableName: string;
  benefitId?: string;
  valueType: AutomationValueType;
  unit?: string;
  timeRange?: "year" | "month" | "day";
  responsibilityRange?: "benefit" | "product" | "plan" | "event";
  baseName?: string;
  defaultValue?: string;
  description?: string;
  custom: boolean;
  enabled: boolean;
};

export type AutomatedBillView = {
  id: string;
  claimCaseId: string;
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
  usedAmount: number;
  configuredAmount?: number;
  remainingAmount?: number;
};

export type CalculationStepResult = FormulaStep & {
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
  amount: number;
  steps: CalculationStepResult[];
};

export type AutomaticCalculationResult = {
  runId: string;
  runNo: string;
  claimCaseId: string;
  committed: boolean;
  totalAmount: number;
  billResults: BillBenefitCalculationResult[];
  ledgerBalances: LedgerBalanceView[];
  createdAt: string;
};
