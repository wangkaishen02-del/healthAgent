import { randomUUID } from "node:crypto";
import type { ClaimOperator } from "../claims/types.ts";
import { requireClaimCaseEditable, requireClaimTransition } from "../claims/state-machine.ts";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { calculationExpressionReferencesAny, evaluateCalculationExpression, substituteCalculationExpression, type FormulaValue } from "./expression-engine.ts";
import type {
  AutomatedBillView,
  AutomationValueType,
  BenefitFormulaView,
  CalculationVariableCategory,
  CalculationVariableView,
  AutomaticCalculationResult,
  BillBenefitCalculationResult,
  CalculationStepResult,
  FormulaStep,
  FormulaValidationResult,
  LedgerBalanceView,
  StandardFormulaView,
} from "./automation-types.ts";

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

const billAmountNames: Record<string, string> = {
  insuranceFundAmount: "医保统筹支付",
  personalAccountAmount: "个人账户支付",
  cashAmount: "个人现金支付",
  selfPaidAmount: "自费金额",
};

const parameterScopeLabels = { policy: "保单", plan: "保障计划", product: "险种", benefit: "责任" } as const;

function mapParameterCatalog(
  item: {
    id: number;
    parameterCode: string;
    policyId: string | null;
    category: string;
    parameterName: string;
    valueType: string;
    unit: string | null;
    dictionaryType: string | null;
    defaultValue: string | null;
    custom: boolean;
  },
  policyId: string,
  dictionaryOptions: Map<string, string[]>,
): CalculationVariableView {
  return {
    id: item.id,
    parameterCode: item.parameterCode,
    policyId: item.policyId ?? policyId,
    category: item.category as CalculationVariableCategory,
    variableName: item.parameterName,
    valueType: item.valueType as AutomationValueType,
    unit: item.unit ?? undefined,
    dictionaryType: item.dictionaryType ?? undefined,
    options: item.dictionaryType ? dictionaryOptions.get(item.dictionaryType) ?? [] : undefined,
    defaultValue: item.defaultValue ?? undefined,
    custom: item.custom,
    enabled: true,
  };
}

function mapLedgerParameterCatalog(
  item: {
    id: number;
    parameterCode: string;
    policyId: string | null;
    parameterName: string;
    valueType: string;
    unit: string | null;
    timeRange: string;
    responsibilityRange: string;
    defaultValue: string | null;
    custom: boolean;
  },
  policyId: string,
): CalculationVariableView {
  return {
    id: item.id,
    parameterCode: item.parameterCode,
    policyId: item.policyId ?? policyId,
    category: "ledger",
    variableName: item.parameterName,
    valueType: item.valueType as AutomationValueType,
    unit: item.unit ?? undefined,
    timeRange: item.timeRange as "year" | "month" | "day",
    responsibilityRange: item.responsibilityRange as "benefit" | "product" | "plan" | "event",
    defaultValue: item.defaultValue ?? undefined,
    custom: item.custom,
    enabled: true,
  };
}

type StoredClaimBill = {
  id: string;
  claimCaseId: string;
  invoiceCode: string;
  invoiceNo: string;
  checkCode: string;
  billType: string;
  patientName: string;
  patientIdNo: string;
  visitNo: string;
  institution: string;
  department: string;
  billDate: Date;
  admissionDate: Date | null;
  dischargeDate: Date | null;
  diagnosis: string;
  medicalInsuranceType: string;
  settlementNo: string;
  totalAmount: Prisma.Decimal;
  cashier: string;
  createdAt: Date;
  updatedAt: Date;
};

type StoredBillAmount = {
  billId: string;
  amountName: string;
  amountValue: Prisma.Decimal;
};

type StoredCustomValue = {
  billId: string;
  variableName: string;
  valueType: string;
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function mapCustomValue(item: StoredCustomValue): string | number | boolean {
  if (["number", "amount", "percentage"].includes(item.valueType)) return Number(item.valueNumber ?? 0);
  if (item.valueType === "boolean") return item.valueBoolean ?? false;
  if (item.valueType === "date") return formatDate(item.valueDate);
  return item.valueText ?? "";
}

function mapBill(
  item: StoredClaimBill,
  amounts: StoredBillAmount[],
  customValues: StoredCustomValue[],
  selectedBenefitIds: string[],
  attachmentIds: string[],
): AutomatedBillView {
  return {
    id: item.id,
    claimCaseId: item.claimCaseId,
    invoiceCode: item.invoiceCode,
    invoiceNo: item.invoiceNo,
    checkCode: item.checkCode,
    billType: item.billType,
    patientName: item.patientName,
    patientIdNo: item.patientIdNo,
    visitNo: item.visitNo,
    institution: item.institution,
    department: item.department,
    billDate: formatDate(item.billDate),
    admissionDate: formatDate(item.admissionDate),
    dischargeDate: formatDate(item.dischargeDate),
    diagnosis: item.diagnosis,
    medicalInsuranceType: item.medicalInsuranceType,
    settlementNo: item.settlementNo,
    totalAmount: Number(item.totalAmount),
    ...Object.fromEntries(Object.entries(billAmountNames).map(([fieldName, amountName]) => [
      fieldName,
      Number(amounts.find((amount) => amount.amountName === amountName)?.amountValue ?? 0),
    ])),
    cashier: item.cashier,
    attachmentIds,
    customValues: Object.fromEntries(customValues.map((value) => [value.variableName, mapCustomValue(value)])),
    selectedBenefitIds,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function loadClaimBills(claimCaseId: string) {
  const bills = await prisma.claimBill.findMany({ where: { claimCaseId }, orderBy: { createdAt: "asc" } });
  if (!bills.length) return [];
  const billIds = bills.map((bill) => bill.id);
  const [amounts, customValues, benefits, attachments] = await Promise.all([
    prisma.claimBillAmount.findMany({ where: { billId: { in: billIds } }, orderBy: { id: "asc" } }),
    prisma.claimBillCustomValue.findMany({ where: { billId: { in: billIds } }, orderBy: { id: "asc" } }),
    prisma.claimBillBenefit.findMany({ where: { billId: { in: billIds } }, orderBy: { id: "asc" } }),
    prisma.claimBillAttachment.findMany({ where: { billId: { in: billIds } }, orderBy: { id: "asc" } }),
  ]);
  return bills.map((bill) => mapBill(
    bill,
    amounts.filter((value) => value.billId === bill.id),
    customValues.filter((value) => value.billId === bill.id),
    benefits.filter((value) => value.billId === bill.id).map((value) => value.benefitId),
    attachments.filter((value) => value.billId === bill.id).map((value) => value.uploadId),
  ));
}

function mapLedger(item: { id: string; policyId: string; insuredPersonId: string; benefitId: string; ledgerCode: string; ledgerName: string; periodYear: number; currentAmount: Prisma.Decimal }): LedgerBalanceView {
  return { ...item, currentAmount: Number(item.currentAmount) };
}

const responsibilityLedgerTemplates = [
  { ledgerCode: "annual_deductible", ledgerName: "累计年免赔额（责任）" },
  { ledgerCode: "annual_payment", ledgerName: "累计年给付金额（责任）" },
] as const;

async function loadLatestNormalizedCalculationResult(
  claimCaseId: string,
  ledgerBalances: LedgerBalanceView[],
  allowedBenefitIds?: Set<string>,
): Promise<AutomaticCalculationResult | null> {
  const caseResult = await prisma.claimCaseCalculationResult.findFirst({
    where: { claimCaseId },
    orderBy: { createdAt: "desc" },
  });
  if (!caseResult) return null;
  const storedBillResults = await prisma.claimBillBenefitCalculationResult.findMany({
    where: {
      calculationResultId: caseResult.id,
      benefitId: allowedBenefitIds ? { in: [...allowedBenefitIds] } : undefined,
    },
    orderBy: { sequenceNo: "asc" },
  });
  const processRows = storedBillResults.length
    ? await prisma.claimCalculationProcess.findMany({
      where: { billBenefitResultId: { in: storedBillResults.map((item) => item.id) } },
      orderBy: [{ billBenefitResultId: "asc" }, { sequenceNo: "asc" }],
    })
    : [];
  const billResults: BillBenefitCalculationResult[] = storedBillResults.map((item) => ({
    billId: item.billId,
    invoiceNo: item.invoiceNo,
    benefitId: item.benefitId,
    benefitCode: item.benefitCode,
    benefitName: item.benefitName,
    formulaName: item.formulaName,
    matched: item.matched,
    matchExpression: item.matchExpression,
    substitutedMatchExpression: item.substitutedMatchExpression,
    amount: Number(item.amount),
    steps: processRows
      .filter((process) => process.billBenefitResultId === item.id)
      .map((process): CalculationStepResult => ({
        id: process.stepId,
        name: process.stepName,
        expression: process.expression,
        substitutedExpression: process.substitutedExpression,
        result: process.resultFlag,
        value: process.resultValue as number | boolean | string,
        ledgerTarget: process.ledgerTargetCode && process.ledgerTargetName
          ? { code: process.ledgerTargetCode, name: process.ledgerTargetName }
          : undefined,
        ledgerOpening: process.ledgerOpeningAmount === null ? undefined : Number(process.ledgerOpeningAmount),
        ledgerClosing: process.ledgerClosingAmount === null ? undefined : Number(process.ledgerClosingAmount),
      })),
  }));
  return {
    runId: caseResult.id,
    runNo: caseResult.runNo,
    claimCaseId,
    committed: true,
    totalAmount: Number(billResults.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    billCount: new Set(billResults.map((item) => item.billId)).size,
    responsibilityResultCount: billResults.length,
    billResults,
    ledgerBalances,
    createdAt: caseResult.createdAt.toISOString(),
  };
}

function ledgerConfiguredAmount(code: string, config: Record<string, string | number>) {
  const value = code === "annual_deductible" ? config["免赔额"]
    : code === "annual_payment" ? config["限额"] ?? config["年度累计赔付限额"]
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

async function policyBenefits(policyId: string, coveragePlanId?: string) {
  const products = await prisma.policyProduct.findMany({
    where: { policyId, coveragePlanId: coveragePlanId || undefined },
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
  const claimCase = claimCaseId ? await prisma.claimCase.findUnique({ where: { id: claimCaseId } }) : null;
  if (claimCaseId && (!claimCase || claimCase.policyId !== policyId)) throw new Error("claim_case_not_found");
  const policyInsured = claimCase
    ? await prisma.policyInsured.findUnique({ where: { id: claimCase.policyInsuredId } })
    : null;
  if (claimCase && !policyInsured?.coveragePlanId) throw new Error("claim_coverage_plan_required");
  const coveragePlanId = policyInsured?.coveragePlanId ?? undefined;
  const benefits = await policyBenefits(policyId, coveragePlanId);
  const allowedBenefitIds = new Set(benefits.map((benefit) => benefit.id));
  const parameterTargetIds = [
    policyId,
    ...benefits.flatMap((benefit) => [benefit.planId, benefit.productId, benefit.id]),
  ].filter((item): item is string => Boolean(item));
  const [storedFormulas, standardFormulaRows, parameterCatalog, ledgerParameterCatalog, dictionaryRows, responsibilityParameters, loadedBills, eventEntries, diseaseEntries] = await Promise.all([
    prisma.benefitCalculationFormula.findMany({
      where: { policyId, benefitId: coveragePlanId ? { in: [...allowedBenefitIds] } : undefined },
      include: { standardFormula: { select: { formulaCode: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.standardCalculationFormula.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.calculationParameterCatalog.findMany({
      where: { OR: [{ policyId: null }, { policyId }] },
      orderBy: [{ category: "asc" }, { parameterName: "asc" }],
    }),
    prisma.calculationLedgerParameterCatalog.findMany({
      where: { OR: [{ policyId: null }, { policyId }] },
      orderBy: { parameterName: "asc" },
    }),
    prisma.systemDictionary.findMany({ where: { enabled: true }, orderBy: [{ dictionaryType: "asc" }, { sequenceNo: "asc" }] }),
    prisma.calculationParameter.findMany({
      where: { targetId: { in: [...new Set(parameterTargetIds)] }, enabled: true },
      include: { definition: true },
      orderBy: { updatedAt: "asc" },
    }),
    claimCaseId ? loadClaimBills(claimCaseId) : Promise.resolve([]),
    claimCaseId ? prisma.claimCaseEventEntry.findMany({ where: { claimCaseId }, orderBy: [{ occurredDate: "asc" }, { createdAt: "asc" }] }) : Promise.resolve([]),
    claimCaseId ? prisma.claimCaseDiseaseEntry.findMany({ where: { claimCaseId }, orderBy: [{ diagnosisDate: "asc" }, { createdAt: "asc" }] }) : Promise.resolve([]),
  ]);
  const bills: AutomatedBillView[] = loadedBills.map((bill) => ({
    ...bill,
    selectedBenefitIds: bill.selectedBenefitIds.filter((benefitId) => allowedBenefitIds.has(benefitId)),
  }));
  const dictionaryOptions = new Map<string, string[]>();
  dictionaryRows.forEach((item) => {
    dictionaryOptions.set(item.dictionaryType, [...(dictionaryOptions.get(item.dictionaryType) ?? []), item.itemName]);
  });
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
      standardFormulaId: formula?.standardFormulaId ?? undefined,
      standardFormulaCode: formula?.standardFormula?.formulaCode ?? undefined,
      updatedAt: formula?.updatedAt.toISOString(),
    };
  });
  const standardFormulas: StandardFormulaView[] = standardFormulaRows.map((formula) => ({
    id: formula.id,
    formulaCode: formula.formulaCode,
    formulaName: formula.formulaName,
    matchExpression: formula.matchExpression,
    steps: normalizeFormulaSteps(formula.steps),
    sourcePolicyId: formula.sourcePolicyId ?? undefined,
    sourceBenefitId: formula.sourceBenefitId ?? undefined,
    createdAt: formula.createdAt.toISOString(),
  }));
  const inheritedParameterVariables = benefits.flatMap((benefit) => {
    const targetByScope = {
      policy: policyId,
      plan: benefit.planId,
      product: benefit.productId,
      benefit: benefit.id,
    };
    return responsibilityParameters
      .filter((item) => targetByScope[item.scope] === item.targetId)
      .map((item) => ({
      policyId,
      category: "benefit" as const,
      variableName: item.definition.parameterName,
      formulaName: `${item.definition.parameterName}（${parameterScopeLabels[item.scope]}）`,
      benefitId: benefit.id,
      parameterScope: item.scope,
      valueType: item.definition.valueType as AutomationValueType,
      unit: item.definition.unit ?? undefined,
      defaultValue: item.parameterValue,
      description: item.description ?? item.definition.description ?? undefined,
      custom: false,
      enabled: true,
    }));
  });
  const variables: CalculationVariableView[] = [
    ...parameterCatalog
      .filter((item) => item.category !== "benefit")
      .map((item) => mapParameterCatalog(item, policyId, dictionaryOptions)),
    ...ledgerParameterCatalog.map((item) => mapLedgerParameterCatalog(item, policyId)),
    ...inheritedParameterVariables,
  ];
  const allowedLedgerScopeIds = coveragePlanId && claimCase ? [
    ...benefits.map((benefit) => benefit.id),
    ...benefits.map((benefit) => `product:${benefit.productId}`),
    `plan:${coveragePlanId}`,
    `event:${claimCase.eventId}`,
  ] : [];
  const rawLedgerBalances = claimCase ? await prisma.claimLedgerCurrentValue.findMany({
    where: {
      policyId,
      insuredPersonId: claimCase.insuredPersonId,
      periodYear: claimCase.reportDate.getUTCFullYear(),
      benefitId: { in: [...new Set(allowedLedgerScopeIds)] },
    },
    orderBy: [{ benefitId: "asc" }, { ledgerCode: "asc" }],
  }) : [];
  const completeLedgerBalances = claimCase ? [
    ...rawLedgerBalances,
    ...benefits.flatMap((benefit) => responsibilityLedgerTemplates.flatMap((template) =>
      rawLedgerBalances.some((item) => item.benefitId === benefit.id && item.ledgerCode === template.ledgerCode)
        ? []
        : [{
          id: `virtual:${benefit.id}:${template.ledgerCode}`,
          policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId: benefit.id,
          ledgerCode: template.ledgerCode,
          ledgerName: template.ledgerName,
          periodYear: claimCase.reportDate.getUTCFullYear(),
          currentAmount: new Prisma.Decimal(0),
        }],
    )),
  ] : rawLedgerBalances;
  const ledgerBalances = await Promise.all(completeLedgerBalances.map(async (item) => {
    const mapped = mapLedger(item);
    const config = await benefitConfigValues(policyId, claimCaseId!, item.benefitId);
    const configuredAmount = ledgerConfiguredAmount(item.ledgerCode, config);
    return { ...mapped, configuredAmount, remainingAmount: configuredAmount === undefined ? undefined : Math.max(0, configuredAmount - mapped.currentAmount) };
  }));
  const latestResult = claimCaseId
    ? await loadLatestNormalizedCalculationResult(claimCaseId, ledgerBalances, allowedBenefitIds)
    : null;
  return {
    benefits,
    formulas,
    standardFormulas,
    variables,
    bills,
    events: eventEntries.map((item) => ({
      id: item.id,
      eventType: item.eventType,
      occurredDate: item.occurredDate.toISOString().slice(0, 10),
      location: item.location ?? "",
      description: item.description,
    })),
    diseases: diseaseEntries.map((item) => ({
      id: item.id,
      diseaseName: item.diseaseName,
      icdCode: item.icdCode ?? "",
      diagnosisDate: item.diagnosisDate.toISOString().slice(0, 10),
      hospital: item.hospital,
      note: item.note ?? "",
    })),
    dictionaries: dictionaryRows.map((item) => ({
      id: item.id,
      dictionaryType: item.dictionaryType,
      typeName: item.typeName,
      itemCode: item.itemCode,
      itemName: item.itemName,
    })),
    ledgerBalances,
    latestResult,
  };
}

export async function listInsuredPolicyLedgers(policyId: string, insuredPersonId: string) {
  const policyInsured = await prisma.policyInsured.findFirst({
    where: { policyId, insuredPersonId },
    include: { insuredPerson: true },
  });
  if (!policyInsured) throw new Error("policy_insured_not_found");
  const rows = await prisma.claimLedgerCurrentValue.findMany({
    where: { policyId, insuredPersonId },
    orderBy: [{ periodYear: "desc" }, { benefitId: "asc" }, { ledgerCode: "asc" }],
  });
  const benefitIds = rows.map((item) => item.benefitId).filter((id) => !id.includes(":"));
  const productIds = rows.filter((item) => item.benefitId.startsWith("product:")).map((item) => item.benefitId.slice(8));
  const planIds = rows.filter((item) => item.benefitId.startsWith("plan:")).map((item) => item.benefitId.slice(5));
  const eventIds = rows.filter((item) => item.benefitId.startsWith("event:")).map((item) => item.benefitId.slice(6));
  const [benefits, products, plans, events] = await Promise.all([
    prisma.policyBenefit.findMany({ where: { id: { in: [...new Set(benefitIds)] } }, select: { id: true, benefitCode: true, benefitName: true } }),
    prisma.policyProduct.findMany({ where: { id: { in: [...new Set(productIds)] } }, select: { id: true, productCode: true, productName: true } }),
    prisma.coveragePlan.findMany({ where: { id: { in: [...new Set(planIds)] } }, select: { id: true, planCode: true, planName: true } }),
    prisma.claimEvent.findMany({ where: { id: { in: [...new Set(eventIds)] } }, select: { id: true, eventNo: true, diagnosis: true } }),
  ]);
  const targetNames = new Map<string, { scope: string; code: string; name: string }>([
    ...benefits.map((item) => [item.id, { scope: "责任", code: item.benefitCode, name: item.benefitName }] as const),
    ...products.map((item) => [`product:${item.id}`, { scope: "险种", code: item.productCode, name: item.productName }] as const),
    ...plans.map((item) => [`plan:${item.id}`, { scope: "计划", code: item.planCode, name: item.planName }] as const),
    ...events.map((item) => [`event:${item.id}`, { scope: "事件", code: item.eventNo, name: item.diagnosis || item.eventNo }] as const),
  ]);
  return {
    policyInsuredId: policyInsured.id,
    insuredPerson: {
      id: policyInsured.insuredPerson.id,
      insuredNo: policyInsured.insuredPerson.insuredNo,
      name: policyInsured.insuredPerson.name,
      idNo: policyInsured.insuredPerson.idNo,
    },
    items: rows.map((item) => ({
      ...mapLedger(item),
      updatedAt: item.updatedAt.toISOString(),
      scope: targetNames.get(item.benefitId)?.scope ?? "责任",
      targetCode: targetNames.get(item.benefitId)?.code ?? item.benefitId,
      targetName: targetNames.get(item.benefitId)?.name ?? item.benefitId,
    })),
  };
}

async function requireProcessingClaimCase(claimCaseId: string) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: claimCaseId }, select: { id: true, status: true } });
  if (!claimCase) throw new Error("claim_case_not_entering");
  requireClaimCaseEditable(claimCase.status, "calculation");
}

export async function saveClaimEventEntry(input: {
  id?: string;
  claimCaseId: string;
  eventType: string;
  occurredDate: string;
  location?: string;
  description: string;
}) {
  await requireProcessingClaimCase(input.claimCaseId);
  const data = {
    claimCaseId: input.claimCaseId,
    eventType: input.eventType.trim(),
    occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`),
    location: input.location?.trim() || null,
    description: input.description.trim(),
  };
  if (!data.eventType || !input.occurredDate || !data.description) throw new Error("claim_event_entry_incomplete");
  const item = input.id
    ? await prisma.claimCaseEventEntry.update({ where: { id: input.id }, data })
    : await prisma.claimCaseEventEntry.create({ data: { id: randomUUID(), ...data } });
  return { ...item, occurredDate: item.occurredDate.toISOString().slice(0, 10), location: item.location ?? "" };
}

export async function deleteClaimEventEntry(id: string) {
  const item = await prisma.claimCaseEventEntry.findUnique({ where: { id }, select: { claimCaseId: true } });
  if (!item) return false;
  await requireProcessingClaimCase(item.claimCaseId);
  await prisma.claimCaseEventEntry.delete({ where: { id } });
  return true;
}

export async function saveClaimDiseaseEntry(input: {
  id?: string;
  claimCaseId: string;
  diseaseName: string;
  icdCode?: string;
  diagnosisDate: string;
  hospital: string;
  note?: string;
}) {
  await requireProcessingClaimCase(input.claimCaseId);
  const data = {
    claimCaseId: input.claimCaseId,
    diseaseName: input.diseaseName.trim(),
    icdCode: input.icdCode?.trim() || null,
    diagnosisDate: new Date(`${input.diagnosisDate}T00:00:00.000Z`),
    hospital: input.hospital.trim(),
    note: input.note?.trim() || null,
  };
  if (!data.diseaseName || !input.diagnosisDate || !data.hospital) throw new Error("claim_disease_entry_incomplete");
  const item = input.id
    ? await prisma.claimCaseDiseaseEntry.update({ where: { id: input.id }, data })
    : await prisma.claimCaseDiseaseEntry.create({ data: { id: randomUUID(), ...data } });
  return { ...item, diagnosisDate: item.diagnosisDate.toISOString().slice(0, 10), icdCode: item.icdCode ?? "", note: item.note ?? "" };
}

export async function deleteClaimDiseaseEntry(id: string) {
  const item = await prisma.claimCaseDiseaseEntry.findUnique({ where: { id }, select: { claimCaseId: true } });
  if (!item) return false;
  await requireProcessingClaimCase(item.claimCaseId);
  await prisma.claimCaseDiseaseEntry.delete({ where: { id } });
  return true;
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
  const [catalogDuplicate, ledgerDuplicate, responsibilityDefinition] = await Promise.all([
    prisma.calculationParameterCatalog.findFirst({
      where: {
        parameterName: variableName,
        OR: [{ policyId: null }, { policyId: input.policyId }],
        ...(input.category !== "ledger" && input.id ? { id: { not: input.id } } : {}),
      },
    }),
    prisma.calculationLedgerParameterCatalog.findFirst({
      where: {
        parameterName: variableName,
        OR: [{ policyId: null }, { policyId: input.policyId }],
        ...(input.category === "ledger" && input.id ? { id: { not: input.id } } : {}),
      },
    }),
    prisma.calculationParameterDefinition.findUnique({ where: { parameterName: variableName } }),
  ]);
  if (catalogDuplicate || ledgerDuplicate || responsibilityDefinition) throw new Error("variable_name_exists");
  if (input.category === "ledger") {
    const ledgerData = {
      policyId: input.policyId,
      parameterName: variableName,
      valueType: input.valueType,
      unit: null,
      timeRange: input.timeRange!,
      responsibilityRange: input.responsibilityRange!,
      defaultValue: input.defaultValue?.trim() || null,
      custom: true,
    };
    const ledgerItem = input.id
      ? await prisma.calculationLedgerParameterCatalog.update({ where: { id: input.id }, data: ledgerData })
      : await prisma.calculationLedgerParameterCatalog.create({ data: ledgerData });
    return mapLedgerParameterCatalog(ledgerItem, input.policyId);
  }
  const data = {
    policyId: input.policyId,
    category: input.category,
    parameterName: variableName,
    valueType: input.valueType,
    unit: null,
    defaultValue: input.defaultValue?.trim() || null,
    custom: true,
  };
  const item = input.id
    ? await prisma.calculationParameterCatalog.update({ where: { id: input.id }, data })
    : await prisma.calculationParameterCatalog.create({ data });
  return {
    id: item.id,
    parameterCode: item.parameterCode,
    policyId: item.policyId ?? input.policyId,
    category: item.category as CalculationVariableCategory,
    variableName: item.parameterName,
    valueType: item.valueType as AutomationValueType,
    unit: item.unit ?? undefined,
    defaultValue: item.defaultValue ?? undefined,
    custom: item.custom,
    enabled: true,
  };
}

export async function saveBenefitFormula(input: {
  policyId: string;
  benefitId: string;
  matchExpression: string;
  steps: FormulaStep[];
}) {
  const existingFormula = await prisma.benefitCalculationFormula.findUnique({
    where: { benefitId: input.benefitId },
    select: { standardFormulaId: true },
  });
  if (existingFormula?.standardFormulaId) throw new Error("formula_reference_locked");
  if (!input.matchExpression.trim()) throw new Error("formula_match_expression_required");
  if (input.steps.length && !input.steps.some((step) => step.result)) throw new Error("formula_result_step_required");
  if (new Set(input.steps.map((step) => step.name.trim())).size !== input.steps.length || input.steps.some((step) => !step.name.trim())) throw new Error("formula_step_name_duplicate");
  const [catalog, ledgerCatalog] = await Promise.all([
    prisma.calculationParameterCatalog.findMany({
      where: { OR: [{ policyId: null }, { policyId: input.policyId }] },
      select: { parameterName: true, category: true },
    }),
    prisma.calculationLedgerParameterCatalog.findMany({
      where: { OR: [{ policyId: null }, { policyId: input.policyId }] },
      select: { parameterName: true },
    }),
  ]);
  const responsibilityNames = catalog.filter((item) => item.category === "benefit");
  const reservedNames = new Set([...catalog, ...ledgerCatalog].map((item) => item.parameterName));
  if (input.steps.some((step) => reservedNames.has(step.name.trim()))) throw new Error("formula_step_name_conflict");
  for (let index = 0; index < input.steps.length; index += 1) {
    const laterNames = input.steps.slice(index + 1).map((step) => step.name.trim()).filter(Boolean);
    if (calculationExpressionReferencesAny(input.steps[index].expression, laterNames)) throw new Error("formula_step_dependency_order_invalid");
  }
  const qualifiedResponsibilityNames = responsibilityNames.flatMap((item) =>
    Object.values(parameterScopeLabels).map((scopeLabel) => `${item.parameterName}（${scopeLabel}）`),
  );
  const variables: Record<string, number | string | boolean> = Object.fromEntries(
    [...reservedNames, ...qualifiedResponsibilityNames].map((name) => [name, 0]),
  );
  evaluateCalculationExpression(input.matchExpression, variables);
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
  return {
    ...item,
    standardFormulaId: item.standardFormulaId ?? undefined,
    steps: normalizeFormulaSteps(item.steps),
    matchExpression: item.matchExpression ?? "",
  };
}

export async function createStandardFormula(policyId: string, benefitId: string) {
  const formula = await prisma.benefitCalculationFormula.findFirst({
    where: { policyId, benefitId },
  });
  if (!formula || !formula.matchExpression?.trim() || !normalizeFormulaSteps(formula.steps).length) {
    throw new Error("formula_not_configured");
  }
  if (formula.standardFormulaId) throw new Error("formula_reference_locked");
  const benefit = await prisma.policyBenefit.findUnique({ where: { id: benefitId }, include: { policyProduct: true } });
  if (!benefit || benefit.policyProduct.policyId !== policyId) throw new Error("benefit_not_found");
  const standard = await prisma.standardCalculationFormula.create({
    data: {
      formulaName: formula.formulaName,
      matchExpression: formula.matchExpression,
      steps: formula.steps as unknown as Prisma.InputJsonValue,
      sourcePolicyId: policyId,
      sourceBenefitId: benefitId,
    },
  });
  return {
    id: standard.id,
    formulaCode: standard.formulaCode,
    formulaName: standard.formulaName,
    matchExpression: standard.matchExpression,
    steps: normalizeFormulaSteps(standard.steps),
    sourcePolicyId: standard.sourcePolicyId ?? undefined,
    sourceBenefitId: standard.sourceBenefitId ?? undefined,
    createdAt: standard.createdAt.toISOString(),
  } satisfies StandardFormulaView;
}

export async function referenceStandardFormula(input: { policyId: string; benefitId: string; standardFormulaId: number }) {
  const [benefit, standard] = await Promise.all([
    prisma.policyBenefit.findUnique({ where: { id: input.benefitId }, include: { policyProduct: true } }),
    prisma.standardCalculationFormula.findUnique({ where: { id: input.standardFormulaId } }),
  ]);
  if (!benefit || benefit.policyProduct.policyId !== input.policyId) throw new Error("benefit_not_found");
  if (!standard) throw new Error("standard_formula_not_found");
  const formula = await prisma.benefitCalculationFormula.upsert({
    where: { benefitId: input.benefitId },
    update: {
      formulaName: standard.formulaName,
      matchExpression: standard.matchExpression,
      steps: standard.steps as unknown as Prisma.InputJsonValue,
      enabled: true,
      standardFormulaId: standard.id,
    },
    create: {
      policyId: input.policyId,
      benefitId: input.benefitId,
      formulaName: standard.formulaName,
      matchExpression: standard.matchExpression,
      steps: standard.steps as unknown as Prisma.InputJsonValue,
      enabled: true,
      standardFormulaId: standard.id,
    },
  });
  return {
    ...formula,
    standardFormulaId: standard.id,
    standardFormulaCode: standard.formulaCode,
    matchExpression: formula.matchExpression ?? "",
    steps: normalizeFormulaSteps(formula.steps),
  };
}

export async function unlinkStandardFormula(policyId: string, benefitId: string) {
  const formula = await prisma.benefitCalculationFormula.findFirst({ where: { policyId, benefitId } });
  if (!formula) throw new Error("formula_not_configured");
  if (!formula.standardFormulaId) throw new Error("formula_not_referenced");
  const unlinked = await prisma.benefitCalculationFormula.update({
    where: { benefitId },
    data: { standardFormulaId: null },
  });
  return {
    ...unlinked,
    standardFormulaId: undefined,
    standardFormulaCode: undefined,
    matchExpression: unlinked.matchExpression ?? "",
    steps: normalizeFormulaSteps(unlinked.steps),
  };
}

export function validateBenefitFormula(input: {
  matchExpression: string;
  steps: FormulaStep[];
  variables: Record<string, FormulaValue>;
}): FormulaValidationResult {
  const variables = { ...input.variables };
  const substitutedMatchExpression = substituteCalculationExpression(input.matchExpression, variables);
  const matched = Boolean(evaluateCalculationExpression(input.matchExpression, variables));
  if (!matched) {
    return {
      matched: false,
      matchExpression: input.matchExpression,
      substitutedMatchExpression,
      steps: [],
    };
  }
  const steps = input.steps.map((step) => {
    const substitutedExpression = substituteCalculationExpression(step.expression, variables);
    const value = evaluateCalculationExpression(step.expression, variables);
    variables[step.name] = value;
    return {
      id: step.id,
      name: step.name,
      expression: step.expression,
      substitutedExpression,
      value,
      result: step.result,
    };
  });
  return {
    matched,
    matchExpression: input.matchExpression,
    substitutedMatchExpression,
    steps,
    result: steps.find((step) => step.result)?.value,
  };
}

export async function deleteBenefitFormula(policyId: string, benefitId: string) {
  const formula = await prisma.benefitCalculationFormula.findFirst({
    where: { policyId, benefitId },
    select: { standardFormulaId: true },
  });
  if (formula?.standardFormulaId) throw new Error("formula_reference_locked");
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
  if (!claimCase) throw new Error("claim_case_not_entering");
  requireClaimCaseEditable(claimCase.status, "calculation");
  const policyInsured = await prisma.policyInsured.findUnique({ where: { id: claimCase.policyInsuredId } });
  if (!policyInsured?.coveragePlanId) throw new Error("claim_coverage_plan_required");
  const attachmentIds = Array.isArray(input.billData.attachmentIds)
    ? input.billData.attachmentIds.filter((item): item is string => typeof item === "string")
    : [];
  if (attachmentIds.length) {
    const matchedAttachments = await prisma.claimAttachment.count({ where: { claimCaseId: input.claimCaseId, uploadId: { in: attachmentIds } } });
    if (matchedAttachments !== new Set(attachmentIds).size) throw new Error("invalid_bill_attachments");
  }
  const benefits = await policyBenefits(claimCase.policyId, policyInsured.coveragePlanId);
  const allowed = new Set(benefits.map((item) => item.id));
  if (!input.selectedBenefitIds.length || input.selectedBenefitIds.some((id) => !allowed.has(id))) throw new Error("invalid_selected_benefits");
  if (input.id) {
    const existing = await prisma.claimBill.findFirst({ where: { id: input.id, claimCaseId: input.claimCaseId }, select: { id: true } });
    if (!existing) throw new Error("claim_bill_not_found");
  }
  const stringValue = (name: string) => typeof input.billData[name] === "string" ? input.billData[name].trim() : "";
  const amountValue = (name: string) => {
    const value = Number(input.billData[name]);
    return Number.isFinite(value) ? value : 0;
  };
  const dateValue = (name: string, required = false) => {
    const value = stringValue(name);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
    if (required) return new Date();
    return null;
  };
  const billData = {
    claimCaseId: input.claimCaseId,
    invoiceCode: stringValue("invoiceCode"),
    invoiceNo: stringValue("invoiceNo"),
    checkCode: stringValue("checkCode"),
    billType: stringValue("billType"),
    patientName: stringValue("patientName"),
    patientIdNo: stringValue("patientIdNo"),
    visitNo: stringValue("visitNo"),
    institution: stringValue("institution"),
    department: stringValue("department"),
    billDate: dateValue("billDate", true)!,
    admissionDate: dateValue("admissionDate"),
    dischargeDate: dateValue("dischargeDate"),
    diagnosis: stringValue("diagnosis"),
    medicalInsuranceType: stringValue("medicalInsuranceType"),
    settlementNo: stringValue("settlementNo"),
    totalAmount: amountValue("totalAmount"),
    cashier: stringValue("cashier"),
  };
  const amountRows = Object.entries(billAmountNames).map(([fieldName, amountName]) => ({
    amountName,
    amountValue: amountValue(fieldName),
  }));
  const customNames = Object.keys(input.customValues);
  const definitions = customNames.length ? await prisma.calculationParameterCatalog.findMany({
    where: { policyId: claimCase.policyId, parameterName: { in: customNames } },
  }) : [];
  const definitionMap = new Map(definitions.map((item) => [item.parameterName, item]));
  const customRows = Object.entries(input.customValues).map(([variableName, value]) => {
    const definition = definitionMap.get(variableName);
    const valueType = definition?.valueType ?? (typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text");
    const numericValue = Number(value);
    const dateText = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    return {
      parameterCatalogId: definition?.id ?? null,
      variableName,
      valueType,
      valueText: valueType === "text" ? String(value ?? "") : null,
      valueNumber: ["number", "amount", "percentage"].includes(valueType) && Number.isFinite(numericValue) ? numericValue : null,
      valueBoolean: valueType === "boolean" ? value === true || value === "true" : null,
      valueDate: valueType === "date" && dateText ? new Date(`${dateText}T00:00:00.000Z`) : null,
    };
  });
  let billId = input.id;
  await prisma.$transaction(async (tx) => {
    const bill = input.id
      ? await tx.claimBill.update({ where: { id: input.id }, data: billData })
      : await tx.claimBill.create({ data: billData });
    billId = bill.id;
    await Promise.all([
      tx.claimBillAmount.deleteMany({ where: { billId: bill.id } }),
      tx.claimBillCustomValue.deleteMany({ where: { billId: bill.id } }),
      tx.claimBillBenefit.deleteMany({ where: { billId: bill.id } }),
      tx.claimBillAttachment.deleteMany({ where: { billId: bill.id } }),
    ]);
    await tx.claimBillAmount.createMany({
      data: amountRows.map((row) => ({ billId: bill.id, ...row })),
    });
    if (customRows.length) await tx.claimBillCustomValue.createMany({
      data: customRows.map((row) => ({ billId: bill.id, ...row })),
    });
    await tx.claimBillBenefit.createMany({
      data: [...new Set(input.selectedBenefitIds)].map((benefitId) => ({ billId: bill.id, benefitId })),
    });
    if (attachmentIds.length) await tx.claimBillAttachment.createMany({
      data: [...new Set(attachmentIds)].map((uploadId) => ({ billId: bill.id, uploadId })),
    });
  });
  const saved = (await loadClaimBills(input.claimCaseId)).find((bill) => bill.id === billId);
  if (!saved) throw new Error("claim_bill_save_failed");
  return saved;
}

export async function deleteClaimBill(id: string) {
  const existing = await prisma.claimBill.findUnique({ where: { id }, select: { id: true, claimCaseId: true } });
  if (!existing) return false;
  await requireProcessingClaimCase(existing.claimCaseId);
  await prisma.$transaction([
    prisma.claimBillAmount.deleteMany({ where: { billId: id } }),
    prisma.claimBillCustomValue.deleteMany({ where: { billId: id } }),
    prisma.claimBillBenefit.deleteMany({ where: { billId: id } }),
    prisma.claimBillAttachment.deleteMany({ where: { billId: id } }),
    prisma.claimBill.deleteMany({ where: { id } }),
  ]);
  return true;
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
  const definitionMap = new Map(definitions.map((item) => [item.id, item]));
  const values: Record<string, string | number> = {};
  parameters.forEach((item) => {
    const definition = definitionMap.get(item.definitionId);
    if (!definition) return;
    const name = definition.parameterName;
    const value = definition.valueType === "boolean"
      ? item.parameterValue === "true" ? "是" : "否"
      : Number.isFinite(Number(item.parameterValue)) ? Number(item.parameterValue) : item.parameterValue;
    values[`${name}（${parameterScopeLabels[item.scope]}）`] = value;
    values[name] = value;
  });
  return values;
}

export async function runAutomaticCalculation(claimCaseId: string, operator: ClaimOperator = { userId: "default-user", userName: "默认用户" }) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: claimCaseId } });
  if (!claimCase) throw new Error("claim_case_not_found");
  const transition = requireClaimTransition(claimCase.status, "calculate");
  if (transition.executor !== "calculation") throw new Error("claim_transition_executor_mismatch");
  const policyInsured = await prisma.policyInsured.findUnique({ where: { id: claimCase.policyInsuredId } });
  if (!policyInsured?.coveragePlanId) throw new Error("claim_coverage_plan_required");
  const benefits = await policyBenefits(claimCase.policyId, policyInsured.coveragePlanId);
  const planClaimEvents = await prisma.claimCase.findMany({
    where: { policyInsuredId: claimCase.policyInsuredId },
    select: { eventId: true },
  });
  const allowedBenefitIds = new Set(benefits.map((benefit) => benefit.id));
  const allowedLedgerScopeIds = new Set([
    ...benefits.map((benefit) => benefit.id),
    ...benefits.map((benefit) => `product:${benefit.productId}`),
    `plan:${policyInsured.coveragePlanId}`,
    ...planClaimEvents.map((item) => `event:${item.eventId}`),
  ]);
  const [loadedBills, formulas, allOpeningBalances, previousCaseEntries, dictionaryRows] = await Promise.all([
    loadClaimBills(claimCaseId),
    prisma.benefitCalculationFormula.findMany({
      where: { policyId: claimCase.policyId, benefitId: { in: [...allowedBenefitIds] } },
    }),
    prisma.claimLedgerCurrentValue.findMany({
      where: { policyId: claimCase.policyId, insuredPersonId: claimCase.insuredPersonId, periodYear: claimCase.reportDate.getUTCFullYear() },
    }),
    prisma.claimLedgerAccumulationRecord.findMany({ where: { claimCaseId } }),
    prisma.systemDictionary.findMany({
      where: { enabled: true, dictionaryType: { in: ["bill_type", "medical_insurance_type", "event_type"] } },
    }),
  ]);
  const bills: AutomatedBillView[] = loadedBills.map((bill) => ({
    ...bill,
    selectedBenefitIds: bill.selectedBenefitIds.filter((benefitId) => allowedBenefitIds.has(benefitId)),
  }));
  if (!bills.length) throw new Error("claim_bills_required");
  if (bills.some((bill) => !bill.selectedBenefitIds.length)) throw new Error("claim_bill_plan_benefits_required");
  const benefitMap = new Map(benefits.map((item) => [item.id, item]));
  const formulaMap = new Map(formulas.map((item) => [item.benefitId, item]));
  const ledgerKey = (scopeKey: string, code: string) => `${scopeKey}::${code}`;
  const previousCaseChanges = new Map<string, number>();
  previousCaseEntries.forEach((item) => {
    const key = ledgerKey(item.benefitId, item.ledgerCode);
    previousCaseChanges.set(key, Number(((previousCaseChanges.get(key) ?? 0) + Number(item.accumulatedAmount)).toFixed(2)));
  });
  const openingBalances = allOpeningBalances.filter((item) => allowedLedgerScopeIds.has(item.benefitId));
  const outOfPlanLedgerIds = allOpeningBalances
    .filter((item) => !allowedLedgerScopeIds.has(item.benefitId))
    .map((item) => item.id);
  const workingLedger = new Map(openingBalances.map((item) => {
    const key = ledgerKey(item.benefitId, item.ledgerCode);
    return [key, Number(Math.max(0, Number(item.currentAmount) - (previousCaseChanges.get(key) ?? 0)).toFixed(2))] as const;
  }));
  const ledgerNames = new Map(openingBalances.map((item) => [ledgerKey(item.benefitId, item.ledgerCode), item.ledgerName]));
  const configCache = new Map<string, Record<string, string | number>>();
  const billResults: BillBenefitCalculationResult[] = [];
  const ledgerChanges: Array<{ billId: string; benefitId: string; code: string; name: string; opening: number; change: number; closing: number }> = [];
  const event = await prisma.claimEvent.findUnique({ where: { id: claimCase.eventId } });
  const dictionaryLabelMaps = new Map<string, Map<string, string>>();
  dictionaryRows.forEach((item) => {
    const labels = dictionaryLabelMaps.get(item.dictionaryType) ?? new Map<string, string>();
    labels.set(item.itemCode, item.itemName);
    dictionaryLabelMaps.set(item.dictionaryType, labels);
  });
  const dictionaryLabel = (type: string, value: unknown) =>
    dictionaryLabelMaps.get(type)?.get(String(value)) ?? String(value);

  for (const bill of bills) {
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
        if (key === "billType") variables[variableName] = dictionaryLabel("bill_type", value);
        else if (key === "medicalInsuranceType") variables[variableName] = dictionaryLabel("medical_insurance_type", value);
        else variables[variableName] = value as string | number | boolean;
      });
      Object.entries(bill.customValues).forEach(([key, value]) => { variables[key] = value; });
      if (event) {
        variables["事件类型"] = dictionaryLabel("event_type", event.eventType);
        variables["事件日期"] = event.occurredDate.toISOString().slice(0, 10);
        variables["事件诊断"] = event.diagnosis ?? "";
      }
      variables["报案日期"] = claimCase.reportDate.toISOString().slice(0, 10);
      for (const scope of ledgerScopes) {
        variables[`累计年免赔额（${scope.suffix}）`] = workingLedger.get(ledgerKey(scope.key, "annual_deductible")) ?? 0;
        variables[`累计年给付金额（${scope.suffix}）`] = workingLedger.get(ledgerKey(scope.key, "annual_payment")) ?? 0;
      }
      const matchExpression = formula.matchExpression ?? "";
      const substitutedMatchExpression = matchExpression ? substituteCalculationExpression(matchExpression, variables) : "";
      const matched = !matchExpression || Boolean(evaluateCalculationExpression(matchExpression, variables));
      if (!matched) {
        billResults.push({
          billId: bill.id,
          invoiceNo: String(bill.invoiceNo ?? ""),
          benefitId,
          benefitCode: benefit.code,
          benefitName: benefit.name,
          formulaName: formula.formulaName,
          matched: false,
          matchExpression,
          substitutedMatchExpression,
          amount: 0,
          steps: [],
        });
        continue;
      }
      const stepResults: CalculationStepResult[] = [];
      let formulaAmount = 0;
      for (const step of formulaSteps) {
        const substitutedExpression = substituteCalculationExpression(step.expression, variables);
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
        stepResults.push({ ...step, substitutedExpression, value, ledgerOpening, ledgerClosing });
      }
      billResults.push({
        billId: bill.id,
        invoiceNo: String(bill.invoiceNo ?? ""),
        benefitId,
        benefitCode: benefit.code,
        benefitName: benefit.name,
        formulaName: formula.formulaName,
        matched: true,
        matchExpression,
        substitutedMatchExpression,
        amount: formulaAmount,
        steps: stepResults,
      });
    }
  }

  const totalAmount = Number(billResults.reduce((sum, item) => sum + Number(item.amount ?? 0), 0).toFixed(2));
  const runId = randomUUID();
  const runNo = `CAL${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}${Math.floor(Math.random() * 900 + 100)}`;
  const ledgerBalances = [...workingLedger.entries()].map(([key, currentAmount]) => {
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
      currentAmount,
      configuredAmount,
      remainingAmount: configuredAmount === undefined ? undefined : Math.max(0, configuredAmount - currentAmount),
    };
  });
  const createdAt = new Date();
  const result: AutomaticCalculationResult = {
    runId,
    runNo,
    claimCaseId,
    committed: true,
    totalAmount,
    billCount: bills.length,
    responsibilityResultCount: billResults.length,
    billResults,
    ledgerBalances,
    createdAt: createdAt.toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.claimLedgerAccumulationRecord.deleteMany({ where: { claimCaseId } });
    if (outOfPlanLedgerIds.length) {
      await tx.claimLedgerCurrentValue.deleteMany({ where: { id: { in: outOfPlanLedgerIds } } });
    }
    await tx.claimCaseCalculationResult.create({
      data: {
        id: runId,
        claimCaseId,
        runNo,
        policyId: claimCase.policyId,
        insuredPersonId: claimCase.insuredPersonId,
        totalAmount,
        billCount: bills.length,
        responsibilityResultCount: billResults.length,
        createdAt,
      },
    });
    for (const [key, currentAmount] of workingLedger.entries()) {
      const separatorIndex = key.lastIndexOf("::");
      const benefitId = key.slice(0, separatorIndex);
      const ledgerCode = key.slice(separatorIndex + 2);
      await tx.claimLedgerCurrentValue.upsert({
        where: { policyId_insuredPersonId_benefitId_ledgerCode_periodYear: {
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId,
          ledgerCode,
          periodYear: claimCase.reportDate.getUTCFullYear(),
        } },
        update: { currentAmount, ledgerName: ledgerNames.get(key) ?? ledgerCode },
        create: {
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId,
          ledgerCode,
          ledgerName: ledgerNames.get(key) ?? ledgerCode,
          periodYear: claimCase.reportDate.getUTCFullYear(),
          currentAmount,
        },
      });
    }
    for (const [sequenceIndex, billResult] of billResults.entries()) {
      const billBenefitResultId = randomUUID();
      await tx.claimBillBenefitCalculationResult.create({
        data: {
          id: billBenefitResultId,
          calculationResultId: runId,
          claimCaseId,
          billId: billResult.billId,
          invoiceNo: billResult.invoiceNo,
          benefitId: billResult.benefitId,
          benefitCode: billResult.benefitCode,
          benefitName: billResult.benefitName,
          formulaName: billResult.formulaName,
          sequenceNo: sequenceIndex + 1,
          matched: billResult.matched !== false,
          matchExpression: billResult.matchExpression ?? "",
          substitutedMatchExpression: billResult.substitutedMatchExpression ?? "",
          amount: billResult.amount,
        },
      });
      if (billResult.steps.length) {
        await tx.claimCalculationProcess.createMany({
          data: billResult.steps.map((step, stepIndex) => ({
            id: randomUUID(),
            billBenefitResultId,
            stepId: step.id,
            stepName: step.name,
            sequenceNo: stepIndex + 1,
            expression: step.expression,
            substitutedExpression: step.substitutedExpression ?? "",
            resultFlag: step.result,
            resultValue: step.value as Prisma.InputJsonValue,
            ledgerTargetCode: step.ledgerTarget?.code,
            ledgerTargetName: step.ledgerTarget?.name,
            ledgerOpeningAmount: step.ledgerOpening,
            ledgerClosingAmount: step.ledgerClosing,
          })),
        });
      }
    }
    for (const change of ledgerChanges) {
      await tx.claimLedgerAccumulationRecord.create({
        data: {
          calculationResultId: runId,
          claimCaseId,
          billId: change.billId,
          policyId: claimCase.policyId,
          insuredPersonId: claimCase.insuredPersonId,
          benefitId: change.benefitId,
          ledgerCode: change.code,
          ledgerName: change.name,
          periodYear: claimCase.reportDate.getUTCFullYear(),
          beforeAmount: change.opening,
          accumulatedAmount: change.change,
          afterAmount: change.closing,
        },
      });
    }
    const changed = await tx.claimCase.updateMany({ where: { id: claimCaseId, status: transition.from }, data: { status: transition.to, currentHandlerUserId: operator.userId, currentHandlerName: operator.userName } });
    if (changed.count !== 1) throw new Error("claim_case_status_locked");
    await tx.claimCaseTransition.create({ data: { id: randomUUID(), claimCaseId, action: transition.transitionAction, fromStatus: transition.from, toStatus: transition.to, operatorUserId: operator.userId, operatorName: operator.userName, targetUserId: operator.userId, targetUserName: operator.userName, description: transition.description } });
  });
  return result;
}

export async function rollbackAutomaticCalculation(claimCaseId: string, operator: ClaimOperator = { userId: "default-user", userName: "默认用户" }) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: claimCaseId } });
  if (!claimCase) throw new Error("claim_case_not_found");
  const transition = requireClaimTransition(claimCase.status, "rollback_calculation");
  if (transition.executor !== "calculation") throw new Error("claim_transition_executor_mismatch");
  await prisma.$transaction(async (tx) => {
    const submitted = await tx.claimCaseTransition.findFirst({ where: { claimCaseId, toStatus: transition.from }, orderBy: { occurredAt: "desc" } });
    const targetUserId = submitted?.operatorUserId ?? "default-user";
    const targetUserName = submitted?.operatorName ?? "默认用户";
    const accumulationRecords = await tx.claimLedgerAccumulationRecord.findMany({ where: { claimCaseId } });
    const rollbackAmounts = new Map<string, {
      policyId: string;
      insuredPersonId: string;
      benefitId: string;
      ledgerCode: string;
      periodYear: number;
      amount: number;
    }>();
    accumulationRecords.forEach((record) => {
      const key = `${record.policyId}::${record.insuredPersonId}::${record.benefitId}::${record.ledgerCode}::${record.periodYear}`;
      const existing = rollbackAmounts.get(key);
      rollbackAmounts.set(key, {
        policyId: record.policyId,
        insuredPersonId: record.insuredPersonId,
        benefitId: record.benefitId,
        ledgerCode: record.ledgerCode,
        periodYear: record.periodYear,
        amount: Number(((existing?.amount ?? 0) + Number(record.accumulatedAmount)).toFixed(2)),
      });
    });
    for (const rollback of rollbackAmounts.values()) {
      const where = {
        policyId_insuredPersonId_benefitId_ledgerCode_periodYear: {
          policyId: rollback.policyId,
          insuredPersonId: rollback.insuredPersonId,
          benefitId: rollback.benefitId,
          ledgerCode: rollback.ledgerCode,
          periodYear: rollback.periodYear,
        },
      };
      const current = await tx.claimLedgerCurrentValue.findUnique({ where });
      if (!current) continue;
      await tx.claimLedgerCurrentValue.update({
        where,
        data: { currentAmount: Number(Math.max(0, Number(current.currentAmount) - rollback.amount).toFixed(2)) },
      });
    }
    const caseResults = await tx.claimCaseCalculationResult.findMany({
      where: { claimCaseId },
      select: { id: true },
    });
    const calculationResultIds = caseResults.map((item) => item.id);
    const billResults = calculationResultIds.length
      ? await tx.claimBillBenefitCalculationResult.findMany({
        where: { calculationResultId: { in: calculationResultIds } },
        select: { id: true },
      })
      : [];
    const billResultIds = billResults.map((item) => item.id);
    if (billResultIds.length) {
      await tx.claimCalculationProcess.deleteMany({ where: { billBenefitResultId: { in: billResultIds } } });
    }
    if (calculationResultIds.length) {
      await tx.claimBillBenefitCalculationResult.deleteMany({ where: { calculationResultId: { in: calculationResultIds } } });
      await tx.claimCaseCalculationResult.deleteMany({ where: { id: { in: calculationResultIds } } });
    }
    await tx.claimLedgerAccumulationRecord.deleteMany({ where: { claimCaseId } });
    await tx.claimCalculationRun.deleteMany({ where: { claimCaseId } });
    const changed = await tx.claimCase.updateMany({ where: { id: claimCaseId, status: transition.from }, data: { status: transition.to, currentHandlerUserId: targetUserId, currentHandlerName: targetUserName } });
    if (changed.count !== 1) throw new Error("claim_case_status_locked");
    await tx.claimCaseTransition.create({ data: { id: randomUUID(), claimCaseId, action: transition.transitionAction, fromStatus: transition.from, toStatus: transition.to, operatorUserId: operator.userId, operatorName: operator.userName, targetUserId, targetUserName, description: `${transition.description}给提交人 ${targetUserName}` } });
  });
  const configuration = await getAutomationConfiguration(claimCase.policyId, claimCaseId);
  return { success: true, ledgerBalances: configuration.ledgerBalances };
}
