import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { evaluateCalculationExpression } from "./expression-engine.ts";
import type {
  AutomatedBillView,
  AutomationValueType,
  BenefitFormulaView,
  CalculationVariableCategory,
  CalculationVariableView,
  FormulaStep,
  LedgerBalanceView,
} from "./automation-types.ts";

const fixedVariables: Array<Omit<CalculationVariableView, "policyId">> = [
  { category: "bill", variableName: "医疗总费用", valueType: "amount", unit: "元", custom: false, enabled: true },
  { category: "bill", variableName: "自费金额", valueType: "amount", unit: "元", custom: false, enabled: true },
  { category: "bill", variableName: "医保统筹支付", valueType: "amount", unit: "元", custom: false, enabled: true },
  { category: "bill", variableName: "个人账户支付", valueType: "amount", unit: "元", custom: false, enabled: true },
  { category: "bill", variableName: "个人现金支付", valueType: "amount", unit: "元", custom: false, enabled: true },
  { category: "bill", variableName: "票据类型", valueType: "text", custom: false, enabled: true },
  { category: "bill", variableName: "收费日期", valueType: "date", custom: false, enabled: true },
  { category: "bill", variableName: "医保类型", valueType: "text", custom: false, enabled: true },
  { category: "event", variableName: "事件类型", valueType: "text", custom: false, enabled: true },
  { category: "event", variableName: "事件日期", valueType: "date", custom: false, enabled: true },
  { category: "event", variableName: "事件诊断", valueType: "text", custom: false, enabled: true },
  { category: "case", variableName: "报案日期", valueType: "date", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年免赔额（责任）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "benefit", baseName: "免赔额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年给付金额（责任）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "benefit", baseName: "给付金额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年免赔额（险种）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "product", baseName: "免赔额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年给付金额（险种）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "product", baseName: "给付金额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年免赔额（计划）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "plan", baseName: "免赔额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年给付金额（计划）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "plan", baseName: "给付金额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年免赔额（事件）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "event", baseName: "免赔额", custom: false, enabled: true },
  { category: "ledger", variableName: "累计年给付金额（事件）", valueType: "amount", unit: "元", timeRange: "year", responsibilityRange: "event", baseName: "给付金额", custom: false, enabled: true },
];

const billVariableFields: Record<string, string> = {
  totalAmount: "医疗总费用",
  selfPaidAmount: "自费金额",
  insuranceFundAmount: "医保统筹支付",
  personalAccountAmount: "个人账户支付",
  cashAmount: "个人现金支付",
  billType: "票据类型",
  billDate: "收费日期",
  medicalInsuranceType: "医保类型",
};

const billTypeLabels: Record<string, string> = { outpatient: "门诊账单", inpatient: "住院账单", pharmacy: "药店购药", other: "其他费用" };
const medicalInsuranceLabels: Record<string, string> = { employee: "城镇职工基本医疗保险", resident: "城乡居民基本医疗保险", new_rural: "新型农村合作医疗", commercial: "商业健康保险", self_pay: "全自费", other: "其他" };
const eventTypeLabels: Record<string, string> = { disease: "疾病", accident: "意外", other: "其他" };

function asObject(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function asStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapBill(item: { id: string; claimCaseId: string; billData: Prisma.JsonValue; customValues: Prisma.JsonValue; selectedBenefitIds: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): AutomatedBillView {
  return {
    id: item.id,
    claimCaseId: item.claimCaseId,
    ...asObject(item.billData),
    customValues: asObject(item.customValues) as Record<string, string | number | boolean>,
    selectedBenefitIds: asStringArray(item.selectedBenefitIds),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function mapLedger(item: { id: string; policyId: string; insuredPersonId: string; benefitId: string; ledgerCode: string; ledgerName: string; periodYear: number; usedAmount: Prisma.Decimal }): LedgerBalanceView {
  return { ...item, usedAmount: Number(item.usedAmount) };
}

function ledgerConfiguredAmount(code: string, config: Record<string, string | number>) {
  const value = code === "annual_deductible" ? config["免赔额"]
    : code === "annual_payment" ? config["年度累计赔付限额"]
    : undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function normalizeFormulaSteps(value: Prisma.JsonValue): FormulaStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, Prisma.JsonValue>;
    if (typeof item.expression !== "string") return [];
    const ledger = item.ledgerTarget && typeof item.ledgerTarget === "object" && !Array.isArray(item.ledgerTarget)
      ? item.ledgerTarget as Record<string, Prisma.JsonValue>
      : null;
    return [{
      id: typeof item.id === "string" ? item.id : `step_${index + 1}`,
      name: typeof item.name === "string" ? item.name : `步骤 ${index + 1}`,
      expression: item.expression,
      result: item.result === true,
      ledgerTarget: ledger && typeof ledger.code === "string" && typeof ledger.name === "string"
        ? { code: ledger.code, name: ledger.name }
        : undefined,
    }];
  });
}

async function policyBenefits(policyId: string) {
  const products = await prisma.policyProduct.findMany({
    where: { policyId },
    include: { benefits: { where: { benefitStatus: "active", claimableFlag: true }, orderBy: { sequenceNo: "asc" } } },
    orderBy: { sequenceNo: "asc" },
  });
  return products.flatMap((product) => product.benefits.map((benefit) => ({
    id: benefit.id,
    code: benefit.benefitCode,
    name: benefit.benefitName,
    productId: product.id,
    planId: product.coveragePlanId,
    productName: product.productName,
  })));
}

export async function getAutomationConfiguration(policyId: string, claimCaseId?: string) {
  const benefits = await policyBenefits(policyId);
  const [storedFormulas, customVariables, responsibilityParameters, bills, claimCase] = await Promise.all([
    prisma.benefitCalculationFormula.findMany({ where: { policyId }, orderBy: { updatedAt: "desc" } }),
    prisma.calculationVariableDefinition.findMany({ where: { policyId, enabled: true }, orderBy: [{ category: "asc" }, { variableName: "asc" }] }),
    prisma.calculationParameter.findMany({ where: { scope: "benefit", targetId: { in: benefits.map((benefit) => benefit.id) }, enabled: true }, include: { definition: true } }),
    claimCaseId ? prisma.claimBill.findMany({ where: { claimCaseId }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    claimCaseId ? prisma.claimCase.findUnique({ where: { id: claimCaseId } }) : Promise.resolve(null),
  ]);
  const formulaMap = new Map(storedFormulas.map((item) => [item.benefitId, item]));
  const formulas: BenefitFormulaView[] = benefits.map((benefit) => {
    const formula = formulaMap.get(benefit.id);
    return {
      id: formula?.id,
      policyId,
      benefitId: benefit.id,
      benefitCode: benefit.code,
      benefitName: benefit.name,
      formulaName: formula?.formulaName ?? `${benefit.name}自动理算公式`,
      matchExpression: formula?.matchExpression ?? "",
      steps: formula ? normalizeFormulaSteps(formula.steps) : [],
      enabled: formula?.enabled ?? true,
      updatedAt: formula?.updatedAt.toISOString(),
    };
  });
  const variables: CalculationVariableView[] = [
    ...fixedVariables.map((item) => ({ ...item, policyId })),
    ...customVariables.map((item) => ({
      id: item.id,
      policyId: item.policyId,
      category: item.category as CalculationVariableCategory,
      variableName: item.variableName,
      valueType: item.valueType as AutomationValueType,
      unit: item.unit ?? undefined,
      timeRange: item.timeRange as "year" | "month" | "day" | undefined,
      responsibilityRange: item.responsibilityRange as "benefit" | "product" | "plan" | "event" | undefined,
      baseName: item.baseName ?? undefined,
      defaultValue: item.defaultValue ?? undefined,
      description: item.description ?? undefined,
      custom: item.custom,
      enabled: item.enabled,
    })),
    ...responsibilityParameters.map((item) => ({
      policyId,
      category: "benefit" as const,
      variableName: item.definition.parameterName,
      benefitId: item.targetId,
      valueType: item.definition.valueType as AutomationValueType,
      unit: item.definition.unit ?? undefined,
      defaultValue: item.parameterValue,
      description: item.description ?? item.definition.description ?? undefined,
      custom: false,
      enabled: true,
    })),
  ];
  const rawLedgerBalances = claimCase ? await prisma.claimLedgerBalance.findMany({
    where: { policyId, insuredPersonId: claimCase.insuredPersonId, periodYear: claimCase.reportDate.getUTCFullYear() },
    orderBy: [{ benefitId: "asc" }, { ledgerCode: "asc" }],
  }) : [];
  const ledgerBalances = await Promise.all(rawLedgerBalances.map(async (item) => {
    const mapped = mapLedger(item);
    const config = await benefitConfigValues(policyId, claimCaseId!, item.benefitId);
    const configuredAmount = ledgerConfiguredAmount(item.ledgerCode, config);
    return { ...mapped, configuredAmount, remainingAmount: configuredAmount === undefined ? undefined : Math.max(0, configuredAmount - mapped.usedAmount) };
  }));
  const latestRun = claimCaseId ? await prisma.claimCalculationRun.findFirst({ where: { claimCaseId }, orderBy: { createdAt: "desc" } }) : null;
  return {
    benefits,
    formulas,
    variables,
    bills: bills.map(mapBill),
    ledgerBalances,
    latestResult: latestRun?.resultData ?? null,
  };
}

export async function saveAutomationVariable(input: {
  id?: number;
  policyId: string;
  category: CalculationVariableCategory;
  variableName: string;
  valueType: AutomationValueType;
  unit?: string;
  timeRange?: "year" | "month" | "day";
  responsibilityRange?: "benefit" | "product" | "plan" | "event";
  defaultValue?: string;
  description?: string;
  enabled: boolean;
}) {
  const rawName = input.variableName.trim();
  if (!rawName) throw new Error("invalid_variable_name");
  if (!["number", "boolean"].includes(input.valueType)) throw new Error("invalid_variable_type");
  if (input.category === "ledger" && (rawName === "免赔额" || rawName === "给付金额")) throw new Error("ledger_name_reserved");
  if (input.category === "ledger" && (!input.timeRange || !input.responsibilityRange)) throw new Error("ledger_scope_required");
  const timeLabels = { year: "年", month: "月", day: "日" } as const;
  const responsibilityLabels = { benefit: "责任", product: "险种", plan: "计划", event: "事件" } as const;
  const variableName = input.category === "ledger"
    ? `累计${timeLabels[input.timeRange!]}${rawName}（${responsibilityLabels[input.responsibilityRange!]}）`
    : rawName;
  if (fixedVariables.some((item) => item.variableName === variableName)) throw new Error("variable_name_exists");
  const [duplicate, responsibilityDefinition] = await Promise.all([
    prisma.calculationVariableDefinition.findFirst({ where: { policyId: input.policyId, variableName, ...(input.id ? { id: { not: input.id } } : {}) } }),
    prisma.calculationParameterDefinition.findUnique({ where: { parameterName: variableName } }),
  ]);
  if (duplicate || responsibilityDefinition) throw new Error("variable_name_exists");
  const data = {
    policyId: input.policyId,
    category: input.category,
    variableName,
    valueType: input.valueType,
    unit: null,
    timeRange: input.category === "ledger" ? input.timeRange : null,
    responsibilityRange: input.category === "ledger" ? input.responsibilityRange : null,
    baseName: input.category === "ledger" ? rawName : null,
    defaultValue: input.defaultValue?.trim() || null,
    description: null,
    custom: true,
    enabled: input.enabled,
  };
  const item = input.id
    ? await prisma.calculationVariableDefinition.update({ where: { id: input.id }, data })
    : await prisma.calculationVariableDefinition.create({ data });
  return { ...item, unit: item.unit ?? undefined, defaultValue: item.defaultValue ?? undefined, description: item.description ?? undefined };
}

export async function saveBenefitFormula(input: {
  policyId: string;
  benefitId: string;
  matchExpression: string;
  steps: FormulaStep[];
}) {
  if (!input.matchExpression.trim()) throw new Error("formula_match_expression_required");
  if (input.steps.length && !input.steps.some((step) => step.result)) throw new Error("formula_result_step_required");
  if (new Set(input.steps.map((step) => step.name.trim())).size !== input.steps.length || input.steps.some((step) => !step.name.trim())) throw new Error("formula_step_name_duplicate");
  const [customNames, responsibilityNames] = await Promise.all([
    prisma.calculationVariableDefinition.findMany({ where: { policyId: input.policyId }, select: { variableName: true } }),
    prisma.calculationParameterDefinition.findMany({ select: { parameterName: true } }),
  ]);
  const reservedNames = new Set([...fixedVariables.map((item) => item.variableName), ...customNames.map((item) => item.variableName), ...responsibilityNames.map((item) => item.parameterName)]);
  if (input.steps.some((step) => reservedNames.has(step.name.trim()))) throw new Error("formula_step_name_conflict");
  for (let index = 0; index < input.steps.length; index += 1) {
    const laterNames = input.steps.slice(index + 1).map((step) => step.name.trim()).filter(Boolean);
    if (laterNames.some((name) => input.steps[index].expression.includes(name))) throw new Error("formula_step_dependency_order_invalid");
  }
  const variables: Record<string, number | string | boolean> = {};
  for (const step of input.steps) {
    const value = evaluateCalculationExpression(step.expression, variables);
    variables[step.name] = value;
  }
  const benefit = await prisma.policyBenefit.findUnique({ where: { id: input.benefitId }, include: { policyProduct: true } });
  if (!benefit || benefit.policyProduct.policyId !== input.policyId) throw new Error("benefit_not_found");
  const item = await prisma.benefitCalculationFormula.upsert({
    where: { benefitId: input.benefitId },
    update: { formulaName: `${benefit.benefitName}自动理算`, matchExpression: input.matchExpression.trim(), steps: input.steps as unknown as Prisma.InputJsonValue, enabled: true },
    create: { policyId: input.policyId, benefitId: input.benefitId, formulaName: `${benefit.benefitName}自动理算`, matchExpression: input.matchExpression.trim(), steps: input.steps as unknown as Prisma.InputJsonValue, enabled: true },
  });
  return { ...item, steps: normalizeFormulaSteps(item.steps), matchExpression: item.matchExpression ?? "" };
}

export async function deleteBenefitFormula(policyId: string, benefitId: string) {
  return (await prisma.benefitCalculationFormula.deleteMany({ where: { policyId, benefitId } })).count > 0;
}

export async function saveClaimBill(input: {
  id?: string;
  claimCaseId: string;
  billData: Record<string, unknown>;
  customValues: Record<string, unknown>;
  selectedBenefitIds: string[];
}) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: input.claimCaseId } });
  if (!claimCase || claimCase.status !== "processing") throw new Error("claim_case_not_processing");
  const benefits = await policyBenefits(claimCase.policyId);
  const allowed = new Set(benefits.map((item) => item.id));
  if (!input.selectedBenefitIds.length || input.selectedBenefitIds.some((id) => !allowed.has(id))) throw new Error("invalid_selected_benefits");
  const data = {
    claimCaseId: input.claimCaseId,
    billData: input.billData as Prisma.InputJsonValue,
    customValues: input.customValues as Prisma.InputJsonValue,
    selectedBenefitIds: input.selectedBenefitIds as Prisma.InputJsonValue,
  };
  const item = input.id ? await prisma.claimBill.update({ where: { id: input.id }, data }) : await prisma.claimBill.create({ data });
  return mapBill(item);
}

export async function deleteClaimBill(id: string) {
  return (await prisma.claimBill.deleteMany({ where: { id } })).count > 0;
}

async function benefitConfigValues(policyId: string, claimCaseId: string, benefitId: string) {
  const [benefit, claimCase, definitions] = await Promise.all([
    prisma.policyBenefit.findUnique({ where: { id: benefitId }, include: { policyProduct: true } }),
    prisma.claimCase.findUnique({ where: { id: claimCaseId } }),
    prisma.calculationParameterDefinition.findMany(),
  ]);
  if (!benefit || !claimCase) return {};
  const insured = await prisma.policyInsured.findUnique({ where: { id: claimCase.policyInsuredId } });
  const targetIds = [policyId, insured?.coveragePlanId, benefit.policyProductId, benefitId].filter((item): item is string => Boolean(item));
  const parameters = await prisma.calculationParameter.findMany({ where: { targetId: { in: targetIds }, enabled: true } });
  const priority = new Map([[policyId, 0], [insured?.coveragePlanId ?? "", 1], [benefit.policyProductId, 2], [benefitId, 3]]);
  parameters.sort((a, b) => (priority.get(a.targetId) ?? 0) - (priority.get(b.targetId) ?? 0));
  const definitionMap = new Map(definitions.map((item) => [item.id, item.parameterName]));
  return Object.fromEntries(parameters.map((item) => [definitionMap.get(item.definitionId)!, Number.isFinite(Number(item.parameterValue)) ? Number(item.parameterValue) : item.parameterValue]));
}

export async function runAutomaticCalculation(claimCaseId: string, commit: boolean) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: claimCaseId } });
  if (!claimCase) throw new Error("claim_case_not_found");
  if (commit) {
    const existing = await prisma.claimCalculationRun.findFirst({ where: { claimCaseId, status: "committed" }, orderBy: { createdAt: "desc" } });
    if (existing) return existing.resultData;
  }
  const [bills, formulas, benefits, openingBalances] = await Promise.all([
    prisma.claimBill.findMany({ where: { claimCaseId }, orderBy: { createdAt: "asc" } }),
    prisma.benefitCalculationFormula.findMany({ where: { policyId: claimCase.policyId } }),
    policyBenefits(claimCase.policyId),
    prisma.claimLedgerBalance.findMany({
      where: { policyId: claimCase.policyId, insuredPersonId: claimCase.insuredPersonId, periodYear: claimCase.reportDate.getUTCFullYear() },
    }),
  ]);
  if (!bills.length) throw new Error("claim_bills_required");
  const benefitMap = new Map(benefits.map((item) => [item.id, item]));
  const formulaMap = new Map(formulas.map((item) => [item.benefitId, item]));
  const ledgerKey = (scopeKey: string, code: string) => `${scopeKey}::${code}`;
  const workingLedger = new Map(openingBalances.map((item) => [ledgerKey(item.benefitId, item.ledgerCode), Number(item.usedAmount)]));
  const ledgerNames = new Map(openingBalances.map((item) => [ledgerKey(item.benefitId, item.ledgerCode), item.ledgerName]));
  const configCache = new Map<string, Record<string, string | number>>();
  const billResults: Array<Record<string, unknown>> = [];
  const ledgerChanges: Array<{ billId: string; benefitId: string; code: string; name: string; opening: number; change: number; closing: number }> = [];
  const event = await prisma.claimEvent.findUnique({ where: { id: claimCase.eventId } });

  for (const billRecord of bills) {
    const bill = mapBill(billRecord);
    for (const benefitId of bill.selectedBenefitIds) {
      const formula = formulaMap.get(benefitId);
      const benefit = benefitMap.get(benefitId);
      if (!formula || !benefit) continue;
      const formulaSteps = normalizeFormulaSteps(formula.steps);
      if (!formulaSteps.length || !formulaSteps.some((step) => step.result)) continue;
      const ledgerScopes = [
        { key: benefitId, suffix: "责任" },
        { key: `product:${benefit.productId}`, suffix: "险种" },
        { key: `plan:${benefit.planId ?? "none"}`, suffix: "计划" },
        { key: `event:${claimCase.eventId}`, suffix: "事件" },
      ];
      if (!configCache.has(benefitId)) configCache.set(benefitId, await benefitConfigValues(claimCase.policyId, claimCaseId, benefitId));
      const variables: Record<string, string | number | boolean> = { ...(configCache.get(benefitId) ?? {}) };
      Object.entries(bill).forEach(([key, value]) => {
        const variableName = billVariableFields[key];
        if (!variableName || !["string", "number", "boolean"].includes(typeof value)) return;
        if (key === "billType") variables[variableName] = billTypeLabels[String(value)] ?? String(value);
        else if (key === "medicalInsuranceType") variables[variableName] = medicalInsuranceLabels[String(value)] ?? String(value);
        else variables[variableName] = value as string | number | boolean;
      });
      Object.entries(bill.customValues).forEach(([key, value]) => { variables[key] = value; });
      if (event) {
        variables["事件类型"] = eventTypeLabels[event.eventType] ?? event.eventType;
        variables["事件日期"] = event.occurredDate.toISOString().slice(0, 10);
        variables["事件诊断"] = event.diagnosis ?? "";
      }
      variables["报案日期"] = claimCase.reportDate.toISOString().slice(0, 10);
      for (const scope of ledgerScopes) {
        variables[`累计年免赔额（${scope.suffix}）`] = workingLedger.get(ledgerKey(scope.key, "annual_deductible")) ?? 0;
        variables[`累计年给付金额（${scope.suffix}）`] = workingLedger.get(ledgerKey(scope.key, "annual_payment")) ?? 0;
      }
      if (formula.matchExpression && !Boolean(evaluateCalculationExpression(formula.matchExpression, variables))) continue;
      const stepResults: Array<Record<string, unknown>> = [];
      let formulaAmount = 0;
      for (const step of formulaSteps) {
        const rawValue = evaluateCalculationExpression(step.expression, variables);
        const value = typeof rawValue === "number" ? Math.max(0, Number(rawValue.toFixed(2))) : rawValue;
        variables[step.name] = value;
        if (step.result) formulaAmount = typeof value === "number" ? value : value ? 1 : 0;
        let ledgerOpening: number | undefined;
        let ledgerClosing: number | undefined;
        if (step.ledgerTarget) {
          const change = typeof value === "number" ? value : value ? 1 : 0;
          for (const scope of ledgerScopes) {
            const key = ledgerKey(scope.key, step.ledgerTarget.code);
            const opening = workingLedger.get(key) ?? 0;
            const closing = Number((opening + change).toFixed(2));
            const ledgerBaseLabel: string = step.ledgerTarget.code === "annual_deductible" ? "免赔额" : "给付金额";
            const name = `累计年${ledgerBaseLabel}（${scope.suffix}）`;
            workingLedger.set(key, closing);
            ledgerNames.set(key, name);
            variables[name] = closing;
            ledgerChanges.push({ billId: bill.id, benefitId: scope.key, code: step.ledgerTarget.code, name, opening, change, closing });
            if (scope.key === benefitId) {
              ledgerOpening = opening;
              ledgerClosing = closing;
            }
          }
        }
        stepResults.push({ ...step, value, ledgerOpening, ledgerClosing });
      }
      billResults.push({
        billId: bill.id,
        invoiceNo: String(bill.invoiceNo ?? ""),
        benefitId,
        benefitCode: benefit.code,
        benefitName: benefit.name,
        formulaName: formula.formulaName,
        amount: formulaAmount,
        steps: stepResults,
      });
    }
  }

  const totalAmount = Number(billResults.reduce((sum, item) => sum + Number(item.amount ?? 0), 0).toFixed(2));
  const runId = randomUUID();
  const runNo = `CAL${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}${Math.floor(Math.random() * 900 + 100)}`;
  const ledgerBalances = [...workingLedger.entries()].map(([key, usedAmount]) => {
    const separatorIndex = key.lastIndexOf("::");
    const benefitId = key.slice(0, separatorIndex);
    const ledgerCode = key.slice(separatorIndex + 2);
    const configuredAmount = benefitId.includes(":") ? undefined : ledgerConfiguredAmount(ledgerCode, configCache.get(benefitId) ?? {});
    return {
      id: openingBalances.find((item) => item.benefitId === benefitId && item.ledgerCode === ledgerCode)?.id ?? `preview-${benefitId}-${ledgerCode}`,
      policyId: claimCase.policyId,
      insuredPersonId: claimCase.insuredPersonId,
      benefitId,
      ledgerCode,
      ledgerName: ledgerNames.get(key) ?? ledgerCode,
      periodYear: claimCase.reportDate.getUTCFullYear(),
      usedAmount,
      configuredAmount,
      remainingAmount: configuredAmount === undefined ? undefined : Math.max(0, configuredAmount - usedAmount),
    };
  });
  const result = { runId, runNo, claimCaseId, committed: commit, totalAmount, billResults, ledgerBalances, createdAt: new Date().toISOString() };

  await prisma.$transaction(async (tx) => {
    await tx.claimCalculationRun.create({
      data: { id: runId, claimCaseId, runNo, status: commit ? "committed" : "preview", totalAmount, resultData: result as unknown as Prisma.InputJsonValue, committedAt: commit ? new Date() : null },
    });
    if (!commit) return;
    for (const change of ledgerChanges) {
      await tx.claimLedgerBalance.upsert({
        where: { policyId_insuredPersonId_benefitId_ledgerCode_periodYear: {
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId: change.benefitId,
          ledgerCode: change.code,
          periodYear: claimCase.reportDate.getUTCFullYear(),
        } },
        update: { usedAmount: change.closing, ledgerName: change.name },
        create: {
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId: change.benefitId,
          ledgerCode: change.code,
          ledgerName: change.name,
          periodYear: claimCase.reportDate.getUTCFullYear(),
          usedAmount: change.closing,
        },
      });
      await tx.claimLedgerEntry.create({
        data: {
          calculationRunId: runId,
          claimCaseId,
          billId: change.billId,
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId: change.benefitId,
          ledgerCode: change.code,
          ledgerName: change.name,
          periodYear: claimCase.reportDate.getUTCFullYear(),
          openingAmount: change.opening,
          changeAmount: change.change,
          closingAmount: change.closing,
        },
      });
    }
  });
  return result;
}
