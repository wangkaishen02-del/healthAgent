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
import { seedScenarioData } from "./scenario-data.ts";

const prisma = new PrismaClient();

function idMap(items: Array<{ id: string }>) {
  return new Map(items.map((item) => [item.id, item.id]));
}

function date(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

const policyIds = idMap(policies);
const planIds = idMap(coveragePlans);
const productIds = idMap(policyProducts);
const benefitIds = idMap(policyBenefits);
const personIds = idMap(insuredPersons);
const policyInsuredIds = idMap(policyInsureds);
const definitionIds = new Map(calculationParameterDefinitions.map((item) => [item.parameterCode, `definition-${item.parameterCode.toLowerCase()}`]));

const dictionarySeed = [
  ["bill_type", "账单类型", [["1", "门诊"], ["2", "住院"], ["3", "门诊特殊病"], ["4", "药店购药"], ["9", "其他费用"]]],
  ["medical_insurance_type", "医保类型", [["1", "城镇职工基本医疗保险"], ["2", "城乡居民基本医疗保险"], ["3", "新型农村合作医疗"], ["4", "商业健康保险"], ["5", "全自费"], ["9", "其他"]]],
  ["event_type", "事件类型", [["1", "疾病"], ["2", "意外"], ["9", "其他"]]],
  ["claim_case_status", "案件状态", [["1", "受理中"], ["2", "处理中"], ["3", "已结案"], ["4", "已撤件"]]],
  ["claim_report_channel", "报案渠道", [["1", "线上报案"], ["2", "电话报案"], ["3", "柜面报案"], ["9", "其他"]]],
  ["claim_payment_method", "赔付方式", [["0", "待确定"], ["1", "银行转账"], ["2", "现金"], ["9", "其他"]]],
  ["attachment_category", "影像件分类", [["1", "申请材料"], ["2", "身份材料"], ["3", "医疗材料"], ["4", "医疗发票"], ["5", "银行材料"], ["9", "其他"]]],
  ["gender", "性别", [["1", "男"], ["2", "女"], ["9", "未知"]]],
  ["id_type", "证件类型", [["1", "居民身份证"], ["2", "护照"], ["9", "其他"]]],
  ["insured_role", "被保人关系", [["1", "员工本人"], ["2", "配偶"], ["3", "子女"], ["4", "父母"], ["9", "其他"]]],
  ["policy_status", "保单状态", [["1", "启用"], ["0", "停用"]]],
  ["product_status", "险种状态", [["1", "有效"], ["0", "无效"]]],
  ["benefit_status", "责任状态", [["1", "有效"], ["0", "无效"]]],
] as const;

const calculationParameterCatalogSeed = [
  { category: "bill", parameterName: "医疗总费用", valueType: "amount", unit: "元" },
  { category: "bill", parameterName: "自费金额", valueType: "amount", unit: "元" },
  { category: "bill", parameterName: "医保统筹支付", valueType: "amount", unit: "元" },
  { category: "bill", parameterName: "个人账户支付", valueType: "amount", unit: "元" },
  { category: "bill", parameterName: "个人现金支付", valueType: "amount", unit: "元" },
  { category: "bill", parameterName: "票据类型", valueType: "text", dictionaryType: "bill_type" },
  { category: "bill", parameterName: "收费日期", valueType: "date" },
  { category: "bill", parameterName: "医保类型", valueType: "text", dictionaryType: "medical_insurance_type" },
  { category: "event", parameterName: "事件类型", valueType: "text", dictionaryType: "event_type" },
  { category: "event", parameterName: "事件日期", valueType: "date" },
  { category: "event", parameterName: "事件诊断", valueType: "text" },
  { category: "benefit", parameterName: "限额", valueType: "amount", unit: "元" },
  { category: "benefit", parameterName: "免赔额", valueType: "amount", unit: "元" },
];

const calculationLedgerParameterCatalogSeed = (["benefit", "product", "plan", "event"] as const).flatMap((responsibilityRange) => [
  { parameterName: `累计年免赔额（${{ benefit: "责任", product: "险种", plan: "计划", event: "事件" }[responsibilityRange]}）`, valueType: "amount", unit: "元", timeRange: "year", responsibilityRange },
  { parameterName: `累计年给付金额（${{ benefit: "责任", product: "险种", plan: "计划", event: "事件" }[responsibilityRange]}）`, valueType: "amount", unit: "元", timeRange: "year", responsibilityRange },
]);

async function seed() {
  for (const [dictionaryType, typeName, items] of dictionarySeed) {
    for (const [itemCode, itemName] of items) {
      await prisma.systemDictionary.upsert({
        where: { dictionaryType_itemCode: { dictionaryType, itemCode } },
        update: { typeName, itemName, enabled: true },
        create: { dictionaryType, typeName, itemCode, itemName, sequenceNo: Number(itemCode), enabled: true },
      });
    }
  }

  for (const item of calculationParameterCatalogSeed) {
    const existing = await prisma.calculationParameterCatalog.findFirst({ where: { policyId: null, parameterName: item.parameterName } });
    if (existing) await prisma.calculationParameterCatalog.update({ where: { id: existing.id }, data: { ...item, custom: false } });
    else await prisma.calculationParameterCatalog.create({ data: { ...item, custom: false } });
  }

  for (const item of calculationLedgerParameterCatalogSeed) {
    const existing = await prisma.calculationLedgerParameterCatalog.findFirst({ where: { policyId: null, parameterName: item.parameterName } });
    if (existing) await prisma.calculationLedgerParameterCatalog.update({ where: { id: existing.id }, data: { ...item, custom: false } });
    else await prisma.calculationLedgerParameterCatalog.create({ data: { ...item, custom: false } });
  }

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
    const definition = await prisma.calculationParameterDefinition.upsert({
      where: { parameterCode: item.parameterCode },
      update: {},
      create: {
        id: definitionIds.get(item.parameterCode)!, parameterCode: item.parameterCode,
        parameterName: item.parameterName, valueType: item.valueType,
        unit: item.unit, applicableScopes: item.applicableScopes, description: item.description,
      },
    });
    definitionIds.set(item.parameterCode, definition.id);
  }

  const targetIds = { policy: policyIds, plan: planIds, product: productIds, benefit: benefitIds };
  for (const item of calculationParameters) {
    const definitionId = definitionIds.get(item.parameterCode)!;
    const targetId = targetIds[item.scope].get(item.targetId)!;
    await prisma.calculationParameter.upsert({
      where: { id: item.id },
      update: { scope: item.scope, targetId, definitionId, parameterValue: item.parameterValue, description: item.description, enabled: item.enabled },
      create: {
        id: item.id, scope: item.scope, targetId, definitionId,
        parameterValue: item.parameterValue, description: item.description, enabled: item.enabled,
      },
    });
  }

  const productPolicyIds = new Map(policyProducts.map((item) => [item.id, item.policyId]));
  const defaultBenefitParameters = { LIMIT: "100000", DEDUCTIBLE: "300", PAYMENT_RATIO: "90" } as const;
  for (const benefit of policyBenefits) {
    for (const [parameterCode, parameterValue] of Object.entries(defaultBenefitParameters)) {
      const definitionId = definitionIds.get(parameterCode);
      if (!definitionId) throw new Error(`Missing calculation parameter definition ${parameterCode}`);
      await prisma.calculationParameter.upsert({
        where: { scope_targetId_definitionId: { scope: "benefit", targetId: benefit.id, definitionId } },
        update: {},
        create: {
          id: `seed-${benefit.id}-${parameterCode.toLowerCase()}`,
          scope: "benefit",
          targetId: benefit.id,
          definitionId,
          parameterValue,
          description: "基础演示责任默认理算参数",
          enabled: true,
        },
      });
    }

    const policyId = productPolicyIds.get(benefit.policyProductId);
    if (!policyId) throw new Error(`Missing policy for product ${benefit.policyProductId}`);
    await prisma.benefitCalculationFormula.upsert({
      where: { benefitId: benefit.id },
      update: {},
      create: {
        policyId,
        benefitId: benefit.id,
        formulaName: `${benefit.benefitName}自动理算`,
        matchExpression: "医疗总费用 > 0",
        steps: [
          { id: "1", name: "可理算费用", expression: "最大(0, 医疗总费用 - 自费金额)", result: false },
          { id: "2", name: "扣除免赔后金额", expression: "最大(0, 可理算费用 - 免赔额)", result: false },
          { id: "3", name: "责任给付金额", expression: "最小(扣除免赔后金额 * 赔付比例 / 100, 限额)", result: true, ledgerTarget: { code: "annual_payment", name: "累计年给付金额" } },
        ],
        enabled: true,
      },
    });
  }

  const insuredPersonId = personIds.get("insured-001")!;
  const initialEvents = [
    { id: "claim-event-001", eventNo: "EV202606120001", eventType: "1", occurredDate: "2026-06-12", administrativeArea: "上海市 / 上海市 / 黄浦区", detailedAddress: "中山东一路附近", hospitalName: "上海市第一人民医院", diagnosis: "急性上呼吸道感染", description: "发热咳嗽后前往门诊就医。" },
    { id: "claim-event-002", eventNo: "EV202604080001", eventType: "2", occurredDate: "2026-04-08", administrativeArea: "上海市 / 上海市 / 徐汇区", detailedAddress: "漕溪北路附近", diagnosis: "踝关节扭伤", description: "步行时不慎扭伤，完成门诊检查。" },
  ];
  for (const item of initialEvents) {
    await prisma.claimEvent.upsert({
      where: { eventNo: item.eventNo }, update: {},
      create: { ...item, insuredPersonId, occurredDate: date(item.occurredDate)! },
    });
  }
  await seedScenarioData(prisma);
}

seed()
  .then(() => console.log("healthAgent database seed completed"))
  .finally(() => prisma.$disconnect());
