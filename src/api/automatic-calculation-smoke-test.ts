import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { getAutomationConfiguration, runAutomaticCalculation, saveAutomationVariable, saveClaimBill } from "../calculation/automation-service.ts";
import { evaluateCalculationExpression } from "../calculation/expression-engine.ts";

const sourceCase = await prisma.claimCase.findFirst({ where: { status: "processing" }, orderBy: { createdAt: "asc" } });
assert(sourceCase, "a processing claim case is required");

const configuration = await getAutomationConfiguration(sourceCase.policyId);
const configuredBenefits = configuration.formulas.filter((formula) => formula.enabled && formula.steps.length);
assert(configuredBenefits.length >= 4, "at least four configured benefits are required");
assert.equal(typeof configuredBenefits[0].id, "number", "formula should use an auto-increment integer id");
assert(configuration.variables.some((variable) => variable.category === "benefit"), "configured responsibility parameters should be available in the formula library");
assert(!configuredBenefits[0].steps.some((step) => /\b(?:bill|config|ledger|step)\./.test(step.expression)), "formula elements should not expose technical codes");
assert.equal(evaluateCalculationExpression('医疗总费用 > 100 并且 票据类型 = "门诊账单"', { 医疗总费用: 120, 票据类型: "门诊账单" }), true);
assert.equal(evaluateCalculationExpression("如果（医疗总费用 > 100）则（医疗总费用 * 0.8）否则（0）", { 医疗总费用: 120 }), 96);

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
    status: "processing",
    remark: "automatic calculation smoke test",
  },
});

try {
  const variableName = `测试自定义数值${Date.now()}`;
  const variable = await saveAutomationVariable({ policyId: sourceCase.policyId, category: "bill", variableName, valueType: "number", enabled: true });
  temporaryVariableId = variable.id;
  assert.equal(typeof variable.id, "number", "custom parameter should receive an auto-increment integer id");
  await assert.rejects(
    saveAutomationVariable({ policyId: sourceCase.policyId, category: "bill", variableName, valueType: "number", enabled: true }),
    /variable_name_exists/,
    "custom parameter names must be unique within a policy",
  );

  const commonBill = {
    invoiceCode: "AUTO",
    checkCode: "TEST",
    billType: "outpatient",
    patientName: "自动理算测试",
    patientIdNo: "TEST",
    visitNo: "VISIT",
    institution: "测试医院",
    department: "内科",
    billDate: sourceCase.reportDate.toISOString().slice(0, 10),
    admissionDate: "",
    dischargeDate: "",
    diagnosis: "测试诊断",
    medicalInsuranceType: "employee",
    settlementNo: "SETTLEMENT",
    insuranceFundAmount: 0,
    personalAccountAmount: 0,
    cashAmount: 0,
    cashier: "测试",
  };
  await saveClaimBill({
    claimCaseId: temporaryCaseId,
    billData: { ...commonBill, invoiceNo: "AUTO-A", totalAmount: 1200, selfPaidAmount: 100 },
    customValues: {},
    selectedBenefitIds: [configuredBenefits[0].benefitId, configuredBenefits[3].benefitId],
  });
  await saveClaimBill({
    claimCaseId: temporaryCaseId,
    billData: { ...commonBill, invoiceNo: "AUTO-B", totalAmount: 800, selfPaidAmount: 50 },
    customValues: {},
    selectedBenefitIds: [configuredBenefits[1].benefitId, configuredBenefits[2].benefitId],
  });

  const preview = await runAutomaticCalculation(temporaryCaseId, false) as { billResults: Array<{ billId: string; benefitId: string }>; totalAmount: number; committed: boolean };
  assert.equal(preview.committed, false);
  assert.equal(preview.billResults.length, 4, "each bill should only run its two selected benefit formulas");
  assert(Number.isFinite(preview.totalAmount));

  const committed = await runAutomaticCalculation(temporaryCaseId, true) as { committed: boolean };
  assert.equal(committed.committed, true);
  const entryCount = await prisma.claimLedgerEntry.count({ where: { claimCaseId: temporaryCaseId } });
  assert(entryCount > 0, "committed calculation should create ledger entries");
  const beforeRetry = entryCount;
  await runAutomaticCalculation(temporaryCaseId, true);
  assert.equal(await prisma.claimLedgerEntry.count({ where: { claimCaseId: temporaryCaseId } }), beforeRetry, "committed calculation should be idempotent");

  const carried = await prisma.claimLedgerBalance.findMany({ where: { insuredPersonId: temporaryPersonId } });
  assert(carried.length > 0, "ledger balances should be available to the next claim");
  console.log(JSON.stringify({ bills: 2, selectedFormulaRuns: preview.billResults.length, ledgerEntries: entryCount, ledgerBalances: carried.length, totalAmount: preview.totalAmount }));
} finally {
  await prisma.$transaction([
    prisma.claimLedgerEntry.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimCalculationRun.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimBill.deleteMany({ where: { claimCaseId: temporaryCaseId } }),
    prisma.claimLedgerBalance.deleteMany({ where: { insuredPersonId: temporaryPersonId } }),
    prisma.calculationVariableDefinition.deleteMany({ where: { id: temporaryVariableId } }),
    prisma.claimCase.deleteMany({ where: { id: temporaryCaseId } }),
  ]);
}
