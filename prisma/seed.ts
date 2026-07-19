import { PrismaClient } from "@prisma/client";
import {
  calculationParameterDefinitions,
  calculationParameters,
  coveragePlans,
  insuredPersons,
  policies,
  policyBenefits,
  policyInsureds,
  policyProducts,
} from "../src/underwriting/mock-data.ts";

const prisma = new PrismaClient();

function stableUuid(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function idMap(items: Array<{ id: string }>, offset: number) {
  return new Map(items.map((item, index) => [item.id, stableUuid(offset + index + 1)]));
}

function date(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

const policyIds = idMap(policies, 0);
const planIds = idMap(coveragePlans, 1000);
const productIds = idMap(policyProducts, 2000);
const benefitIds = idMap(policyBenefits, 3000);
const personIds = idMap(insuredPersons, 4000);
const policyInsuredIds = idMap(policyInsureds, 5000);
const definitionIds = new Map(calculationParameterDefinitions.map((item, index) => [item.parameterCode, stableUuid(6001 + index)]));

async function seed() {
  for (const item of policies) {
    await prisma.policy.upsert({
      where: { policyNo: item.policyNo },
      update: {},
      create: {
        id: policyIds.get(item.id)!, policyNo: item.policyNo, policyName: item.policyName,
        applicantName: item.applicantName, holderType: item.holderType, policyStatus: item.policyStatus,
        effectiveDate: date(item.effectiveDate)!, expiryDate: date(item.expiryDate)!, currency: item.currency,
        totalPremium: item.totalPremium, insuredCount: item.insuredCount, issueDate: date(item.issueDate),
        underwritingDate: date(item.underwritingDate), remark: item.remark,
      },
    });
  }

  for (const item of coveragePlans) {
    await prisma.coveragePlan.upsert({
      where: { policyId_planCode: { policyId: policyIds.get(item.policyId)!, planCode: item.planCode } },
      update: {},
      create: {
        id: planIds.get(item.id)!, policyId: policyIds.get(item.policyId)!, planCode: item.planCode,
        planName: item.planName, effectiveDate: date(item.effectiveDate)!, expiryDate: date(item.expiryDate)!,
        status: item.status, remark: item.remark,
      },
    });
  }

  for (const item of policyProducts) {
    await prisma.policyProduct.upsert({
      where: { productNo: item.productNo },
      update: {},
      create: {
        id: productIds.get(item.id)!, policyId: policyIds.get(item.policyId)!, coveragePlanId: planIds.get(item.coveragePlanId),
        productNo: item.productNo, productCode: item.productCode, productName: item.productName,
        productStatus: item.productStatus, effectiveDate: date(item.effectiveDate)!, expiryDate: date(item.expiryDate)!,
        premium: item.premium, sumInsured: item.sumInsured, sequenceNo: item.sequenceNo, remark: item.remark,
      },
    });
  }

  for (const item of policyBenefits) {
    await prisma.policyBenefit.upsert({
      where: { benefitNo: item.benefitNo },
      update: {},
      create: {
        id: benefitIds.get(item.id)!, policyProductId: productIds.get(item.policyProductId)!,
        benefitNo: item.benefitNo, benefitCode: item.benefitCode, benefitName: item.benefitName,
        benefitStatus: item.benefitStatus, effectiveDate: date(item.effectiveDate)!, expiryDate: date(item.expiryDate)!,
        sequenceNo: item.sequenceNo, claimableFlag: item.claimableFlag, remark: item.remark,
      },
    });
  }

  for (const item of insuredPersons) {
    await prisma.insuredPerson.upsert({
      where: { insuredNo: item.insuredNo },
      update: {},
      create: {
        id: personIds.get(item.id)!, insuredNo: item.insuredNo, name: item.name, gender: item.gender,
        birthDate: date(item.birthDate), idType: item.idType, idNo: item.idNo, phone: item.phone,
      },
    });
  }

  for (const item of policyInsureds) {
    await prisma.policyInsured.upsert({
      where: { policyId_insuredPersonId: { policyId: policyIds.get(item.policyId)!, insuredPersonId: personIds.get(item.insuredPersonId)! } },
      update: { coveragePlanId: item.coveragePlanId ? planIds.get(item.coveragePlanId) : null },
      create: {
        id: policyInsuredIds.get(item.id)!, policyId: policyIds.get(item.policyId)!,
        coveragePlanId: item.coveragePlanId ? planIds.get(item.coveragePlanId) : undefined,
        insuredPersonId: personIds.get(item.insuredPersonId)!, effectiveDate: date(item.effectiveDate)!,
        expiryDate: date(item.expiryDate)!, joinDate: date(item.joinDate), leaveDate: date(item.leaveDate),
        insuredRole: item.insuredRole, remark: item.remark,
      },
    });
  }

  for (const item of calculationParameterDefinitions) {
    await prisma.calculationParameterDefinition.upsert({
      where: { parameterCode: item.parameterCode },
      update: {},
      create: {
        id: definitionIds.get(item.parameterCode)!, parameterCode: item.parameterCode,
        parameterName: item.parameterName, valueType: item.valueType,
        unit: item.unit, applicableScopes: item.applicableScopes, description: item.description,
      },
    });
  }

  const targetIds = { policy: policyIds, plan: planIds, product: productIds, benefit: benefitIds };
  for (const [index, item] of calculationParameters.entries()) {
    const definitionId = definitionIds.get(item.parameterCode)!;
    const targetId = targetIds[item.scope].get(item.targetId)!;
    await prisma.calculationParameter.upsert({
      where: { scope_targetId_definitionId: { scope: item.scope, targetId, definitionId } },
      update: { parameterValue: item.parameterValue, description: item.description, enabled: item.enabled },
      create: {
        id: stableUuid(7001 + index), scope: item.scope, targetId, definitionId,
        parameterValue: item.parameterValue, description: item.description, enabled: item.enabled,
      },
    });
  }

  const insuredPersonId = personIds.get("insured-001")!;
  const initialEvents = [
    { id: stableUuid(8001), eventNo: "EV202606120001", eventType: "disease" as const, occurredDate: "2026-06-12", administrativeArea: "上海市 / 上海市 / 黄浦区", detailedAddress: "中山东一路附近", hospitalName: "上海市第一人民医院", diagnosis: "急性上呼吸道感染", description: "发热咳嗽后前往门诊就医。" },
    { id: stableUuid(8002), eventNo: "EV202604080001", eventType: "accident" as const, occurredDate: "2026-04-08", administrativeArea: "上海市 / 上海市 / 徐汇区", detailedAddress: "漕溪北路附近", diagnosis: "踝关节扭伤", description: "步行时不慎扭伤，完成门诊检查。" },
  ];
  for (const item of initialEvents) {
    await prisma.claimEvent.upsert({
      where: { eventNo: item.eventNo }, update: {},
      create: { ...item, insuredPersonId, occurredDate: date(item.occurredDate)! },
    });
  }
}

seed()
  .then(() => console.log("healthAgent database seed completed"))
  .finally(() => prisma.$disconnect());
