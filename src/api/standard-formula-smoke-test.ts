import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import {
  createStandardFormula,
  deleteManagedStandardFormula,
  getAutomationConfiguration,
  listStandardFormulas,
  referenceStandardFormula,
  saveBenefitFormula,
  updateManagedStandardFormula,
} from "../calculation/automation-service.ts";

const source = await prisma.benefitCalculationFormula.findFirst({
  where: { standardFormulaId: null },
  include: { standardFormula: true },
  orderBy: { id: "asc" },
});
assert(source?.matchExpression && Array.isArray(source.steps) && source.steps.length, "需要至少一条已配置的非引用公式作为测试源");

const allBenefits = await prisma.policyBenefit.findMany({ include: { policyProduct: true }, orderBy: { id: "asc" } });
const configured = await prisma.benefitCalculationFormula.findMany({ select: { benefitId: true } });
const configuredIds = new Set(configured.map((item) => item.benefitId));
const targetBenefit = allBenefits.find((item) => item.id !== source.benefitId && !configuredIds.has(item.id))
  ?? allBenefits.find((item) => item.id !== source.benefitId);
assert(targetBenefit, "需要另一个责任验证标准公式引用");

const originalTarget = await prisma.benefitCalculationFormula.findUnique({ where: { benefitId: targetBenefit.id } });
assert(!originalTarget?.standardFormulaId, "测试目标责任不能已经引用标准公式");

let standardId: number | undefined;
try {
  const standard = await createStandardFormula(source.policyId, source.benefitId);
  standardId = standard.id;
  assert.match(standard.formulaCode, /^SF\d{8}$/);

  const referenced = await referenceStandardFormula({
    policyId: targetBenefit.policyProduct.policyId,
    benefitId: targetBenefit.id,
    standardFormulaId: standard.id,
  });
  assert.equal(referenced.standardFormulaCode, standard.formulaCode);
  assert.equal(referenced.standardFormulaId, standard.id);

  const updatedStandard = await updateManagedStandardFormula({
    id: standard.id,
    formulaName: `${standard.formulaName}测试`,
    matchExpression: standard.matchExpression,
    steps: standard.steps,
    tags: ["医疗", "住院", "医疗"],
  });
  assert.deepEqual(updatedStandard.tags, ["医疗", "住院"]);
  assert.equal(updatedStandard.referenceCount, 1);
  assert.equal((await listStandardFormulas()).find((item) => item.id === standard.id)?.formulaName, updatedStandard.formulaName);
  assert.equal((await prisma.benefitCalculationFormula.findUnique({ where: { benefitId: targetBenefit.id } }))?.formulaName, updatedStandard.formulaName);

  const configuration = await getAutomationConfiguration(targetBenefit.policyProduct.policyId);
  const configuredTarget = configuration.formulas.find((item) => item.benefitId === targetBenefit.id);
  assert.equal(configuredTarget?.standardFormulaCode, standard.formulaCode, "保单理赔配置应返回标准公式编号");

  await assert.rejects(
    () => saveBenefitFormula({
      policyId: targetBenefit.policyProduct.policyId,
      benefitId: targetBenefit.id,
      matchExpression: referenced.matchExpression,
      steps: referenced.steps,
    }),
    /formula_reference_locked/,
  );

  const deleted = await deleteManagedStandardFormula(standard.id);
  standardId = undefined;
  assert.equal(deleted.unlinkedReferenceCount, 1);
  const unlinked = await prisma.benefitCalculationFormula.findUniqueOrThrow({ where: { benefitId: targetBenefit.id } });
  assert.equal(unlinked.standardFormulaId, null);
  await saveBenefitFormula({
    policyId: targetBenefit.policyProduct.policyId,
    benefitId: targetBenefit.id,
    matchExpression: unlinked.matchExpression ?? "",
    steps: referenced.steps,
  });
} finally {
  await prisma.benefitCalculationFormula.deleteMany({ where: { benefitId: targetBenefit.id } });
  if (originalTarget) {
    await prisma.benefitCalculationFormula.create({
      data: {
        policyId: originalTarget.policyId,
        benefitId: originalTarget.benefitId,
        formulaName: originalTarget.formulaName,
        matchExpression: originalTarget.matchExpression,
        steps: originalTarget.steps as unknown as Prisma.InputJsonValue,
        enabled: originalTarget.enabled,
        standardFormulaId: originalTarget.standardFormulaId,
      },
    });
  }
  if (standardId) await prisma.standardCalculationFormula.delete({ where: { id: standardId } });
  await prisma.$disconnect();
}

console.log("standard-formula-smoke-test: ok");
