import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { getAutomationConfiguration, rollbackAutomaticCalculation, runAutomaticCalculation, saveAutomationVariable, saveClaimBill, validateBenefitFormula } from "../calculation/automation-service.ts";
import { calculationExpressionIdentifiers, calculationExpressionReferencesAny, evaluateCalculationExpression } from "../calculation/expression-engine.ts";
import { ClaimsService } from "../../apps/api/src/claims/claims.service.ts";
import { transitionClaimCaseDb } from "../claims/prisma-service.ts";

const sourceCase = await prisma.claimCase.findFirst({ where: { status: "entering" }, orderBy: { createdAt: "asc" } });
assert(sourceCase, "a processing claim case is required");

const configuration = await getAutomationConfiguration(sourceCase.policyId);
const scopedConfiguration = await getAutomationConfiguration(sourceCase.policyId, sourceCase.id);
const sourcePolicyInsured = await prisma.policyInsured.findUnique({ where: { id: sourceCase.policyInsuredId } });
assert(sourcePolicyInsured?.coveragePlanId, "the insured person must belong to a coverage plan");
assert.equal(await prisma.systemDictionary.count({ where: { dictionaryType: "bill_type" } }), 5, "bill type dictionary should contain all configured values");
assert(await prisma.systemDictionary.findFirst({ where: { dictionaryType: "bill_type", itemCode: "1", itemName: "门诊" } }), "bill type code 1 should represent outpatient");
assert.equal(await prisma.calculationParameterCatalog.count({ where: { category: "ledger" } }), 0, "generic calculation parameter catalog must not contain ledger parameters");
assert.equal(await prisma.calculationLedgerParameterCatalog.count({ where: { policyId: null } }), 8, "ledger parameters should be stored in their dedicated catalog");
assert(await prisma.calculationParameterDefinition.findUnique({ where: { parameterCode: "PAYMENT_RATIO" } }), "payment ratio configuration definition should exist");
const configuredBenefits = scopedConfiguration.formulas.filter((formula) => formula.enabled && formula.steps.length);
assert(configuredBenefits.length >= 2, "at least two configured benefits are required in the insured person's coverage plan");
const scopedBenefitIds = new Set(scopedConfiguration.benefits.map((benefit) => benefit.id));
assert(scopedConfiguration.benefits.every((benefit) => benefit.planId === sourcePolicyInsured.coveragePlanId), "claim configuration should only expose responsibilities in the insured person's coverage plan");
for (const benefit of scopedConfiguration.benefits) {
  const responsibilityLedgerCodes = scopedConfiguration.ledgerBalances
    .filter((item) => item.benefitId === benefit.id)
    .map((item) => item.ledgerCode);
  assert(responsibilityLedgerCodes.includes("annual_deductible"), `responsibility ${benefit.id} should expose annual deductible even without a stored current value`);
  assert(responsibilityLedgerCodes.includes("annual_payment"), `responsibility ${benefit.id} should expose annual payment even without a stored current value`);
}
const outOfPlanBenefit = configuration.benefits.find((benefit) => !scopedBenefitIds.has(benefit.id));
assert(outOfPlanBenefit, "the test policy should contain a benefit outside the insured person's coverage plan");
assert.equal(typeof configuredBenefits[0].id, "number", "formula should use an auto-increment integer id");
assert(configuration.variables.some((variable) => variable.category === "benefit"), "configured responsibility parameters should be available in the formula library");
assert.deepEqual(
  configuration.variables.find((variable) => variable.variableName === "票据类型")?.options,
  ["门诊", "住院", "门诊特殊病", "药店购药", "其他费用"],
  "fixed parameter options should be loaded from the dictionary table",
);
assert(!configuredBenefits[0].steps.some((step) => /\b(?:bill|config|ledger|step)\./.test(step.expression)), "formula elements should not expose technical codes");
assert.equal(evaluateCalculationExpression('医疗总费用 > 100 并且 票据类型 = "门诊账单"', { 医疗总费用: 120, 票据类型: "门诊账单" }), true);
assert.equal(evaluateCalculationExpression('医疗总费用 > 100 并且 票据类型 = "门诊账单"', { 医疗总费用: 0, 票据类型: "门诊账单" }), false);
assert.equal(evaluateCalculationExpression('医疗总费用 > 100 或者 票据类型 = "门诊账单"', { 医疗总费用: 120, 票据类型: "住院账单" }), true);
assert.equal(evaluateCalculationExpression("如果（医疗总费用 > 100）则（医疗总费用 * 0.8）否则（0）", { 医疗总费用: 120 }), 96);
assert.equal(evaluateCalculationExpression("取大（100，200）", {}), 200);
assert.equal(evaluateCalculationExpression("取小（100，200）", {}), 100);
assert.equal(calculationExpressionReferencesAny("累计年给付金额（责任） + 100", ["给付金额"]), false, "partial parameter names must not be treated as later-step references");
assert.equal(calculationExpressionReferencesAny("给付金额 + 100", ["给付金额"]), true, "exact later-step references must be detected");
assert.deepEqual(calculationExpressionIdentifiers("医疗总费用 - 免赔额（责任）", ["医疗总费用", "免赔额（责任）", "免赔额"]), ["医疗总费用", "免赔额（责任）"]);
const validation = validateBenefitFormula({
  matchExpression: '医疗总费用 > 100 并且 票据类型 = "门诊账单"',
  steps: [
    { id: "1", name: "扣除免赔额后金额", expression: "医疗总费用 - 免赔额（责任）", result: false },
    { id: "2", name: "责任给付金额", expression: "扣除免赔额后金额 * 0.8", result: true },
  ],
  variables: { 医疗总费用: 1200, 票据类型: "门诊账单", "免赔额（责任）": 200 },
});
assert.equal(validation.matched, true);
assert.equal(validation.steps[0].substitutedExpression, "1200 - 200");
assert.equal(validation.result, 800);
const unmatchedValidation = validateBenefitFormula({
  matchExpression: "医疗总费用 > 100",
  steps: [{ id: "1", name: "不应执行", expression: "医疗总费用 / 0", result: true }],
  variables: { 医疗总费用: 50 },
});
assert.equal(unmatchedValidation.matched, false);
assert.deepEqual(unmatchedValidation.steps, []);
assert.equal(unmatchedValidation.result, undefined);

const temporaryCaseId = randomUUID();
const temporaryPersonId = `auto-test-${randomUUID()}`;
let temporaryVariableId: number | undefined;
await prisma.claimCase.create({
  data: {
    id: temporaryCaseId,
    caseNo: `AUTOTEST${Date.now()}`,
    policyId: sourceCase.policyId,
    policyInsuredId: sourceCase.policyInsuredId,
    insuredPersonId: temporaryPersonId,
    eventId: sourceCase.eventId,
    reportDate: sourceCase.reportDate,
    reportChannel: sourceCase.reportChannel,
    status: "entering",
    remark: "automatic calculation smoke test",
  },
});

try {
  const variableName = `测试自定义数值${Date.now()}`;
  const variable = await saveAutomationVariable({ policyId: sourceCase.policyId, category: "bill", variableName, valueType: "number" });
  temporaryVariableId = variable.id;
  assert.equal(typeof variable.id, "number", "custom parameter should receive an auto-increment integer id");
  assert.match(variable.parameterCode ?? "", /^BQ\d{4}$/, "custom bill parameters should receive a fixed-width BQ code");
  await assert.rejects(
    saveAutomationVariable({ policyId: sourceCase.policyId, category: "bill", variableName, valueType: "number" }),
    /variable_name_exists/,
    "custom parameter names must be unique within a policy",
  );

  const commonBill = {
    invoiceCode: "AUTO",
    checkCode: "TEST",
    billType: "1",
    patientName: "自动理算测试",
    patientIdNo: "TEST",
    visitNo: "VISIT",
    institution: "测试医院",
    department: "内科",
    billDate: sourceCase.reportDate.toISOString().slice(0, 10),
    admissionDate: "",
    dischargeDate: "",
    diagnosis: "测试诊断",
    medicalInsuranceType: "1",
    settlementNo: "SETTLEMENT",
    insuranceFundAmount: 0,
    personalAccountAmount: 0,
    cashAmount: 0,
    cashier: "测试",
  };
  await assert.rejects(
    saveClaimBill({
      claimCaseId: temporaryCaseId,
      billData: { ...commonBill, invoiceNo: "OUT-OF-PLAN", totalAmount: 100, selfPaidAmount: 0 },
      customValues: {},
      selectedBenefitIds: [outOfPlanBenefit.id],
    }),
    /invalid_selected_benefits/,
    "a bill must not select a responsibility outside the insured person's coverage plan",
  );
  const firstBill = await saveClaimBill({
    claimCaseId: temporaryCaseId,
    billData: { ...commonBill, invoiceNo: "AUTO-A", totalAmount: 1200, selfPaidAmount: 100 },
    customValues: { [variableName]: 25 },
    selectedBenefitIds: [configuredBenefits[0].benefitId, configuredBenefits[1].benefitId],
  });
  assert(await prisma.claimBillCustomValue.findFirst({
    where: { billId: firstBill.id, parameterCatalogId: variable.id },
  }), "bill custom values should reference the unified calculation parameter catalog");
  await saveClaimBill({
    claimCaseId: temporaryCaseId,
    billData: { ...commonBill, invoiceNo: "AUTO-B", totalAmount: 800, selfPaidAmount: 50 },
    customValues: {},
    selectedBenefitIds: [configuredBenefits[0].benefitId, configuredBenefits[1].benefitId],
  });

  const calculated = await runAutomaticCalculation(temporaryCaseId, { userId: "calculation-test-user", userName: "理算测试用户" }) as {
    runId: string;
    billResults: Array<{
      billId: string;
      benefitId: string;
      matchExpression: string;
      substitutedMatchExpression: string;
      steps: Array<{ substitutedExpression: string }>;
    }>;
    totalAmount: number;
    committed: boolean;
  };
  assert.equal(calculated.committed, true);
  assert.equal(calculated.billResults.length, 4, "each bill should only run its two selected benefit formulas");
  assert(calculated.billResults.every((item) => scopedBenefitIds.has(item.benefitId)), "calculation results must stay within the insured person's coverage plan");
  assert(calculated.billResults.every((item) => item.substitutedMatchExpression && item.steps.every((step) => step.substitutedExpression)), "calculation process should retain substituted expressions");
  assert(Number.isFinite(calculated.totalAmount));
  assert.equal((await prisma.claimCaseTransition.findFirst({ where: { claimCaseId: temporaryCaseId, action: "calculate" }, orderBy: { occurredAt: "desc" } }))?.operatorUserId, "calculation-test-user");
  assert(await prisma.claimCaseCalculationResult.findUnique({ where: { id: calculated.runId } }), "calculation should persist a case result");
  const billBenefitResults = await prisma.claimBillBenefitCalculationResult.findMany({ where: { calculationResultId: calculated.runId } });
  assert.equal(billBenefitResults.length, 4, "calculation should persist one result per bill and responsibility");
  assert(await prisma.claimCalculationProcess.count({ where: { billBenefitResultId: { in: billBenefitResults.map((item) => item.id) } } }) > 0, "calculation should persist step processes");
  const entryCount = await prisma.claimLedgerAccumulationRecord.count({ where: { claimCaseId: temporaryCaseId } });
  assert(entryCount > 0, "calculation should directly create ledger entries");
  const beforeRetry = entryCount;
  await assert.rejects(runAutomaticCalculation(temporaryCaseId), /claim_case_not_entering/, "a calculated case must be rolled back before calculation can run again");
  assert.equal(await prisma.claimLedgerAccumulationRecord.count({ where: { claimCaseId: temporaryCaseId } }), beforeRetry, "a rejected repeated calculation must not change ledger entries");

  const carried = await prisma.claimLedgerCurrentValue.findMany({ where: { insuredPersonId: temporaryPersonId } });
  assert(carried.length > 0, "ledger balances should be available to the next claim");
  const allowedLedgerScopeIds = new Set([
    ...scopedConfiguration.benefits.map((benefit) => benefit.id),
    ...scopedConfiguration.benefits.map((benefit) => `product:${benefit.productId}`),
    `plan:${sourcePolicyInsured.coveragePlanId}`,
    `event:${sourceCase.eventId}`,
  ]);
  assert(carried.every((item) => allowedLedgerScopeIds.has(item.benefitId)), "ledger current values must stay within the insured person's coverage plan");
  await rollbackAutomaticCalculation(temporaryCaseId, { userId: "review-test-user", userName: "审核测试用户" });
  assert.equal((await prisma.claimCaseTransition.findFirst({ where: { claimCaseId: temporaryCaseId, action: "rollback_calculation" }, orderBy: { occurredAt: "desc" } }))?.operatorUserId, "review-test-user");
  assert.equal(await prisma.claimCalculationProcess.count({ where: { billBenefitResultId: { in: billBenefitResults.map((item) => item.id) } } }), 0, "rollback should delete formula step processes");
  assert.equal(await prisma.claimLedgerAccumulationRecord.count({ where: { claimCaseId: temporaryCaseId } }), 0, "rollback should delete the case accumulation records");
  assert.equal(await prisma.claimCaseCalculationResult.count({ where: { claimCaseId: temporaryCaseId } }), 0, "rollback should delete the case result");
  assert.equal(await prisma.claimBillBenefitCalculationResult.count({ where: { claimCaseId: temporaryCaseId } }), 0, "rollback should delete bill responsibility results");
  const rolledBackCurrentValues = await prisma.claimLedgerCurrentValue.findMany({ where: { insuredPersonId: temporaryPersonId } });
  assert(rolledBackCurrentValues.every((item) => Number(item.currentAmount) === 0), "rollback should restore ledger current values");
  const recalculated = await runAutomaticCalculation(temporaryCaseId, { userId: "calculation-test-user", userName: "理算测试用户" });
  assert.equal(recalculated.committed, true, "the case should support calculation again after rollback");
  await transitionClaimCaseDb(temporaryCaseId, "submit_review", { userId: "calculation-test-user", userName: "理算测试用户" });
  const cancelled = await new ClaimsService().cancelCase(temporaryCaseId, { userId: "review-test-user", userName: "审核测试用户" });
  assert.equal(cancelled?.status, "cancelled", "withdrawing a calculated case should finish in cancelled state");
  assert.equal(await prisma.claimLedgerAccumulationRecord.count({ where: { claimCaseId: temporaryCaseId } }), 0, "withdrawing a calculated case should delete its accumulation records");
  assert.equal(await prisma.claimCaseCalculationResult.count({ where: { claimCaseId: temporaryCaseId } }), 0, "withdrawing a calculated case should delete its calculation result");
  assert((await prisma.claimLedgerCurrentValue.findMany({ where: { insuredPersonId: temporaryPersonId } })).every((item) => Number(item.currentAmount) === 0), "withdrawing a calculated case should restore ledger current values");
  console.log(JSON.stringify({ bills: 2, selectedFormulaRuns: calculated.billResults.length, ledgerEntries: entryCount, ledgerBalances: carried.length, totalAmount: calculated.totalAmount }));
} finally {
  const temporaryBillIds = (await prisma.claimBill.findMany({
    where: { claimCaseId: temporaryCaseId },
    select: { id: true },
  })).map((bill) => bill.id);
  const calculationResultIds = (await prisma.claimCaseCalculationResult.findMany({
    where: { claimCaseId: temporaryCaseId },
    select: { id: true },
  })).map((item) => item.id);
  const billBenefitResultIds = (await prisma.claimBillBenefitCalculationResult.findMany({
    where: { calculationResultId: { in: calculationResultIds } },
    select: { id: true },
  })).map((item) => item.id);
  await prisma.$transaction([
    prisma.claimCalculationProcess.deleteMany({ where: { billBenefitResultId: { in: billBenefitResultIds } } }),
    prisma.claimBillBenefitCalculationResult.deleteMany({ where: { calculationResultId: { in: calculationResultIds } } }),
    prisma.claimCaseCalculationResult.deleteMany({ where: { id: { in: calculationResultIds } } }),
    prisma.claimLedgerAccumulationRecord.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimCalculationRun.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimBillAmount.deleteMany({ where: { billId: { in: temporaryBillIds } } }),
    prisma.claimBillCustomValue.deleteMany({ where: { billId: { in: temporaryBillIds } } }),
    prisma.claimBillBenefit.deleteMany({ where: { billId: { in: temporaryBillIds } } }),
    prisma.claimBillAttachment.deleteMany({ where: { billId: { in: temporaryBillIds } } }),
    prisma.claimBill.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimLedgerCurrentValue.deleteMany({ where: { insuredPersonId: temporaryPersonId } }),
    prisma.calculationParameterCatalog.deleteMany({ where: { id: temporaryVariableId } }),
    prisma.claimCase.deleteMany({ where: { id: temporaryCaseId } }),
  ]);
}
