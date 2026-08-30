import type { ClaimCaseStatus, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const operator = { userId: "default-user", userName: "默认用户" };

const scenarioPolicies = [
  { key: "hy24", id: "demo-policy-hy24", no: "GI2024000101", company: "华曜科技有限公司", name: "华曜科技2024年度团体保障计划", start: "2024-01-01", end: "2024-12-31", status: "disabled" as const, people: 18 },
  { key: "hy25", id: "demo-policy-hy25", no: "GI2025000101", company: "华曜科技有限公司", name: "华曜科技2025年度团体保障计划", start: "2025-01-01", end: "2025-12-31", status: "disabled" as const, people: 22 },
  { key: "hy27", id: "demo-policy-hy27", no: "GI2027000101", company: "华曜科技有限公司", name: "华曜科技2027年度团体保障计划", start: "2027-01-01", end: "2027-12-31", status: "enabled" as const, people: 24 },
  { key: "yw25", id: "demo-policy-yw25", no: "GI2025000201", company: "远望制造有限公司", name: "远望制造2025年度团体保障计划", start: "2025-02-01", end: "2026-01-31", status: "disabled" as const, people: 12 },
  { key: "yw27", id: "demo-policy-yw27", no: "GI2027000201", company: "远望制造有限公司", name: "远望制造2027年度团体保障计划", start: "2027-02-01", end: "2028-01-31", status: "enabled" as const, people: 15 },
  { key: "xh25", id: "demo-policy-xh25", no: "GI2025000301", company: "星禾咨询（上海）有限公司", name: "星禾咨询2025年度员工福利保单", start: "2025-03-01", end: "2026-02-28", status: "disabled" as const, people: 10 },
  { key: "hc26", id: "demo-policy-hc26", no: "GI2026000401", company: "海川物流集团有限公司", name: "海川物流2026年度员工综合保障计划", start: "2026-01-01", end: "2026-12-31", status: "enabled" as const, people: 20 },
  { key: "yf26", id: "demo-policy-yf26", no: "GI2026000501", company: "云帆生物医药有限公司", name: "云帆生物2026年度员工健康保障计划", start: "2026-04-01", end: "2027-03-31", status: "enabled" as const, people: 16 },
];

const extraPeople = [
  ["035", "陆远", "male", "1988-02-11"], ["036", "叶青", "female", "1992-05-19"],
  ["037", "莫凡", "male", "1990-08-07"], ["038", "方怡", "female", "1995-10-23"],
  ["039", "梁硕", "male", "1987-12-15"], ["040", "陶然", "female", "1991-06-06"],
  ["041", "谢宁", "male", "1993-01-27"], ["042", "汪敏", "female", "1989-09-12"],
  ["043", "余杭", "male", "1994-04-20"], ["044", "江月", "female", "1990-11-08"],
  ["045", "杜峰", "male", "1986-03-17"], ["046", "白露", "female", "1996-07-29"],
  ["047", "雷鸣", "male", "1992-02-02"], ["048", "夏彤", "female", "1993-08-18"],
  ["049", "钱程", "male", "1989-05-25"], ["050", "乔安", "female", "1994-12-09"],
  ["051", "石磊", "male", "1988-10-31"], ["052", "温岚", "female", "1991-01-16"],
  ["053", "康健", "male", "1995-03-05"], ["054", "任雪", "female", "1990-06-22"],
] as const;

function asDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function compactDate(value: Date) {
  return dateOnly(value).replaceAll("-", "");
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function statusPath(status: ClaimCaseStatus, rolledBack: boolean) {
  const rows: Array<{ action: string; fromStatus: string | null; toStatus: string; description: string }> = [
    { action: "create", fromStatus: null, toStatus: "registered", description: "创建案件" },
  ];
  if (status === "registered") {
    if (rolledBack) rows.push(
      { action: "submit", fromStatus: "registered", toStatus: "entering", description: "受理完成并提交录入" },
      { action: "rollback", fromStatus: "entering", toStatus: "registered", description: "录入退回受理补充资料" },
    );
    return rows;
  }
  if (status === "cancelled") {
    if (rolledBack) rows.push({ action: "submit", fromStatus: "registered", toStatus: "entering", description: "受理完成并提交录入" });
    rows.push({ action: "cancel", fromStatus: rolledBack ? "entering" : "registered", toStatus: "cancelled", description: rolledBack ? "客户在录入阶段申请撤件" : "客户在受理阶段申请撤件" });
    return rows;
  }
  rows.push({ action: "submit", fromStatus: "registered", toStatus: "entering", description: "受理完成并提交录入" });
  if (status === "entering") {
    if (rolledBack) rows.push(
      { action: "calculate", fromStatus: "entering", toStatus: "calculating", description: "完成自动理算" },
      { action: "rollback_calculation", fromStatus: "calculating", toStatus: "entering", description: "理算回退后重新录入账单" },
    );
    return rows;
  }
  rows.push({ action: "calculate", fromStatus: "entering", toStatus: "calculating", description: "完成自动理算" });
  if (status === "calculating") return rows;
  rows.push({ action: "submit_review", fromStatus: "calculating", toStatus: "reviewing", description: "理算完成并提交审核" });
  if (status === "reviewing") return rows;
  rows.push({ action: "complete", fromStatus: "reviewing", toStatus: "completed", description: "审核通过并结案" });
  return rows;
}

export async function seedScenarioData(prisma: PrismaClient) {
  for (const [sequence, name, gender, birthDate] of extraPeople) {
    const id = `demo-person-${sequence}`;
    await prisma.insuredPerson.upsert({
      where: { insuredNo: `INS${sequence}` },
      update: { name, phone: `1390000${sequence}` },
      create: {
        id, insuredNo: `INS${sequence}`, name, gender, birthDate: asDate(birthDate), idType: "id_card",
        idNo: `310101${birthDate.replaceAll("-", "")}${sequence.padStart(4, "0")}`, phone: `1390000${sequence}`,
        occupationCode: sequence < "045" ? "IT001" : "OP001", occupationName: sequence < "045" ? "技术与管理人员" : "运营人员",
      },
    });
  }

  const people = await prisma.insuredPerson.findMany({ orderBy: { insuredNo: "asc" } });
  const definitions = await prisma.calculationParameterDefinition.findMany({ where: { parameterCode: { in: ["LIMIT", "DEDUCTIBLE", "PAYMENT_RATIO"] } } });
  const definitionByCode = new Map(definitions.map((item) => [item.parameterCode, item.id]));

  for (const [policyIndex, item] of scenarioPolicies.entries()) {
    await prisma.policy.upsert({
      where: { policyNo: item.no },
      update: { policyName: item.name, policyStatus: item.status, insuredCount: item.people },
      create: {
        id: item.id, policyNo: item.no, policyName: item.name, applicantName: item.company, holderType: "company",
        policyStatus: item.status, effectiveDate: asDate(item.start), expiryDate: asDate(item.end), currency: "CNY",
        totalPremium: 120000 + policyIndex * 18500, insuredCount: item.people, issueDate: addDays(asDate(item.start), -20),
        underwritingDate: addDays(asDate(item.start), -12), remark: "场景数据：用于跨年度续保、多保单和理赔流程测试。",
      },
    });
    const planId = `demo-plan-${item.key}`;
    await prisma.coveragePlan.upsert({
      where: { policyId_planCode: { policyId: item.id, planCode: "PLAN-STANDARD" } },
      update: { planName: `${item.company.replace(/有限公司|（上海）/g, "")}标准保障计划` },
      create: { id: planId, policyId: item.id, planCode: "PLAN-STANDARD", planName: `${item.company.replace(/有限公司|（上海）/g, "")}标准保障计划`, effectiveDate: asDate(item.start), expiryDate: asDate(item.end), status: "active" },
    });

    const productDefinitions = [
      { suffix: "med", productCode: "1001", productName: "团体医疗保险", premium: 76000, sumInsured: 1000000, benefits: [["2001", "住院医疗责任"], ["2002", "门急诊医疗责任"]] },
      { suffix: "acc", productCode: "1002", productName: "团体意外伤害保险", premium: 44000, sumInsured: 1500000, benefits: [["2003", "意外伤害责任"], ["2004", "意外医疗责任"]] },
    ] as const;
    for (const [productIndex, product] of productDefinitions.entries()) {
      const productId = `demo-product-${item.key}-${product.suffix}`;
      await prisma.policyProduct.upsert({
        where: { productNo: `PP-${item.key.toUpperCase()}-${productIndex + 1}` },
        update: { productName: product.productName, productStatus: "active" },
        create: {
          id: productId, policyId: item.id, coveragePlanId: planId, productNo: `PP-${item.key.toUpperCase()}-${productIndex + 1}`,
          productCode: product.productCode, productName: product.productName, productStatus: "active",
          effectiveDate: asDate(item.start), expiryDate: asDate(item.end), premium: product.premium, sumInsured: product.sumInsured, sequenceNo: productIndex + 1,
        },
      });
      for (const [benefitIndex, [benefitCode, benefitName]] of product.benefits.entries()) {
        const benefitId = `demo-benefit-${item.key}-${product.suffix}-${benefitIndex + 1}`;
        await prisma.policyBenefit.upsert({
          where: { benefitNo: `PB-${item.key.toUpperCase()}-${productIndex + 1}${benefitIndex + 1}` },
          update: { benefitName, benefitStatus: "active", claimableFlag: true },
          create: {
            id: benefitId, policyProductId: productId, benefitNo: `PB-${item.key.toUpperCase()}-${productIndex + 1}${benefitIndex + 1}`,
            benefitCode, benefitName, benefitStatus: "active", effectiveDate: asDate(item.start), expiryDate: asDate(item.end), sequenceNo: benefitIndex + 1, claimableFlag: true,
          },
        });
        const parameterValues = { LIMIT: product.suffix === "med" ? "100000" : "50000", DEDUCTIBLE: product.suffix === "med" ? "300" : "100", PAYMENT_RATIO: product.suffix === "med" ? "90" : "100" };
        for (const [code, parameterValue] of Object.entries(parameterValues)) {
          const definitionId = definitionByCode.get(code);
          if (!definitionId) continue;
          await prisma.calculationParameter.upsert({
            where: { scope_targetId_definitionId: { scope: "benefit", targetId: benefitId, definitionId } },
            update: { parameterValue, enabled: true },
            create: { id: `demo-param-${item.key}-${product.suffix}-${benefitIndex + 1}-${code.toLowerCase()}`, scope: "benefit", targetId: benefitId, definitionId, parameterValue, description: "场景数据默认理算参数", enabled: true },
          });
        }
        await prisma.benefitCalculationFormula.upsert({
          where: { benefitId },
          update: {},
          create: {
            policyId: item.id, benefitId, formulaName: `${benefitName}自动理算`, matchExpression: "医疗总费用 > 0",
            steps: [
              { id: "1", name: "可理算费用", expression: "最大(0, 医疗总费用 - 自费金额)", result: false },
              { id: "2", name: "扣除免赔后金额", expression: "最大(0, 可理算费用 - 免赔额)", result: false },
              { id: "3", name: "责任给付金额", expression: "最小(扣除免赔后金额 * 赔付比例 / 100, 限额)", result: true, ledgerTarget: { code: "annual_payment", name: "累计年给付金额" } },
            ], enabled: true,
          },
        });
      }
    }

    const offset = (policyIndex * 7) % Math.max(1, people.length - item.people);
    const selectedPeople = Array.from({ length: item.people }, (_, index) => people[(offset + index) % people.length]);
    for (const [personIndex, person] of selectedPeople.entries()) {
      await prisma.policyInsured.upsert({
        where: { policyId_insuredPersonId: { policyId: item.id, insuredPersonId: person.id } },
        update: { coveragePlanId: planId, effectiveDate: asDate(item.start), expiryDate: asDate(item.end) },
        create: {
          id: `demo-pi-${item.key}-${String(personIndex + 1).padStart(2, "0")}`, policyId: item.id, coveragePlanId: planId,
          insuredPersonId: person.id, effectiveDate: asDate(item.start), expiryDate: asDate(item.end), joinDate: asDate(item.start),
          insuredRole: personIndex > 0 && personIndex % 11 === 0 ? "spouse" : "employee", remark: personIndex % 9 === 0 ? "跨年度连续参保人员" : null,
        },
      });
    }
  }

  const activePolicyIds = ["policy-001", "policy-002", "demo-policy-hc26", "demo-policy-yf26"];
  const historicalPolicyIds = scenarioPolicies.filter((item) => item.status === "disabled").map((item) => item.id);
  const [activeInsureds, historicalInsureds, benefits] = await Promise.all([
    prisma.policyInsured.findMany({ where: { policyId: { in: activePolicyIds } }, include: { policy: true, insuredPerson: true }, orderBy: [{ policyId: "asc" }, { insuredPersonId: "asc" }] }),
    prisma.policyInsured.findMany({ where: { policyId: { in: historicalPolicyIds } }, include: { policy: true, insuredPerson: true }, orderBy: [{ policyId: "asc" }, { insuredPersonId: "asc" }] }),
    prisma.policyBenefit.findMany({ include: { policyProduct: true }, orderBy: { id: "asc" } }),
  ]);
  const benefitsByPolicy = new Map<string, typeof benefits>();
  for (const benefit of benefits) {
    const rows = benefitsByPolicy.get(benefit.policyProduct.policyId) ?? [];
    rows.push(benefit);
    benefitsByPolicy.set(benefit.policyProduct.policyId, rows);
  }

  const statuses: ClaimCaseStatus[] = [
    ...Array(8).fill("registered"), ...Array(8).fill("entering"), ...Array(8).fill("calculating"),
    ...Array(8).fill("reviewing"), ...Array(10).fill("completed"), ...Array(6).fill("cancelled"),
  ];
  const ledgerTotals = new Map<string, { policyId: string; personId: string; scopeId: string; amount: number; year: number }>();

  for (const [caseIndex, status] of statuses.entries()) {
    const caseId = `demo-case-${String(caseIndex + 1).padStart(3, "0")}`;
    const existingCase = await prisma.claimCase.findUnique({ where: { id: caseId } });
    const historical = status === "completed" || status === "cancelled";
    const pool = historical && historicalInsureds.length ? historicalInsureds : activeInsureds;
    const generatedPolicyInsured = pool[(caseIndex * 5 + (historical ? 3 : 0)) % pool.length];
    const policyInsured = existingCase
      ? await prisma.policyInsured.findUnique({ where: { id: existingCase.policyInsuredId }, include: { policy: true, insuredPerson: true } })
      : generatedPolicyInsured;
    if (!policyInsured) throw new Error(`Missing policy insured for scenario case ${caseId}`);
    const start = policyInsured.policy.effectiveDate;
    const reportDate = addDays(start, 18 + (caseIndex * 17) % 220);
    const generatedReportDate = reportDate > policyInsured.policy.expiryDate ? addDays(policyInsured.policy.expiryDate, -10) : reportDate;
    const safeReportDate = existingCase?.reportDate ?? generatedReportDate;
    const caseNo = existingCase?.caseNo ?? `CL${compactDate(safeReportDate)}${String(500 + caseIndex).padStart(4, "0")}`;
    const eventId = existingCase?.eventId ?? `demo-event-${String(caseIndex + 1).padStart(3, "0")}`;
    const existingEvent = await prisma.claimEvent.findUnique({ where: { id: eventId } });
    const eventNo = existingEvent?.eventNo ?? `EV${compactDate(addDays(safeReportDate, -2))}${String(500 + caseIndex).padStart(4, "0")}`;
    const eventType = caseIndex % 4 === 0 ? "2" : caseIndex % 7 === 0 ? "9" : "1";
    const diagnosis = eventType === "2" ? ["腕关节扭伤", "踝关节软组织损伤", "头部轻微外伤"][caseIndex % 3] : ["急性支气管炎", "腰椎间盘突出", "胆囊炎", "胃肠炎"][caseIndex % 4];
    const hospital = ["上海市第一人民医院", "复旦大学附属中山医院", "上海交通大学医学院附属瑞金医院", "上海市第六人民医院"][caseIndex % 4];
    await prisma.claimEvent.upsert({
      where: { id: eventId },
      update: { diagnosis, hospitalName: hospital },
      create: {
        id: eventId, eventNo, insuredPersonId: policyInsured.insuredPersonId, eventType, occurredDate: addDays(safeReportDate, -2),
        administrativeArea: caseIndex % 2 ? "上海市 / 上海市 / 浦东新区" : "上海市 / 上海市 / 徐汇区",
        detailedAddress: caseIndex % 2 ? "世纪大道附近" : "漕溪北路附近", hospitalName: hospital, diagnosis,
        description: eventType === "2" ? "日常活动中意外受伤后前往医院检查治疗。" : "出现不适症状后前往医院就诊并完成相关检查。",
      },
    });
    const createdAt = addDays(safeReportDate, 0);
    await prisma.claimCase.upsert({
      where: { id: caseId },
      update: { status, currentHandlerUserId: operator.userId, currentHandlerName: operator.userName },
      create: {
        id: caseId, caseNo, policyId: policyInsured.policyId, policyInsuredId: policyInsured.id, insuredPersonId: policyInsured.insuredPersonId,
        eventId, reportDate: safeReportDate, reportChannel: ["online", "phone", "counter", "other"][caseIndex % 4] as "online" | "phone" | "counter" | "other",
        status, currentHandlerUserId: operator.userId, currentHandlerName: operator.userName,
        remark: caseIndex % 5 === 0 ? "场景案件：资料需重点核对。" : "场景案件数据。", createdAt, updatedAt: addDays(createdAt, Math.min(5, caseIndex % 6)),
      },
    });

    const person = policyInsured.insuredPerson;
    const parties = [
      { role: "insured" as const, name: person.name, idNo: person.idNo ?? "", relation: "本人", bank: false },
      { role: "applicant" as const, name: caseIndex % 4 === 0 ? `${person.name}家属` : person.name, idNo: person.idNo ?? "", relation: caseIndex % 4 === 0 ? "配偶" : "本人", bank: false },
      { role: "payee" as const, name: person.name, idNo: person.idNo ?? "", relation: "本人", bank: true },
    ];
    for (const [partyIndex, party] of parties.entries()) {
      await prisma.claimParty.upsert({
        where: { claimCaseId_role: { claimCaseId: caseId, role: party.role } },
        update: { name: party.name },
        create: {
          id: `demo-party-${String(caseIndex + 1).padStart(3, "0")}-${partyIndex + 1}`, claimCaseId: caseId, role: party.role,
          name: party.name, gender: person.gender ?? "unknown", birthDate: person.birthDate, idType: person.idType ?? "id_card", idNo: party.idNo,
          idLongTerm: true, address: "上海市浦东新区示例路 100 号", phone: person.phone ?? "13800000000", relationToInsured: party.relation,
          bankName: party.bank ? ["中国工商银行", "招商银行", "中国建设银行"][caseIndex % 3] : null,
          bankAccountName: party.bank ? person.name : null, bankAccountNo: party.bank ? `622200000000${String(caseIndex + 1).padStart(4, "0")}` : null,
          paymentMethod: party.bank ? "bank_transfer" : null,
        },
      });
    }

    const path = statusPath(status, caseIndex % 4 === 0);
    for (const [transitionIndex, transition] of path.entries()) {
      await prisma.claimCaseTransition.upsert({
        where: { id: `demo-transition-${String(caseIndex + 1).padStart(3, "0")}-${transitionIndex + 1}` },
        update: transition,
        create: {
          id: `demo-transition-${String(caseIndex + 1).padStart(3, "0")}-${transitionIndex + 1}`, claimCaseId: caseId, ...transition,
          operatorUserId: operator.userId, operatorName: operator.userName, targetUserId: operator.userId, targetUserName: operator.userName,
          occurredAt: addDays(createdAt, transitionIndex),
        },
      });
    }
    const remarkStages = status === "registered" ? ["acceptance"] : status === "entering" ? ["acceptance", "calculation"] : status === "reviewing" || status === "completed" ? ["acceptance", "calculation", "review"] : ["acceptance", "calculation"];
    for (const [remarkIndex, stage] of remarkStages.entries()) {
      await prisma.claimCaseRemark.upsert({
        where: { id: `demo-remark-${String(caseIndex + 1).padStart(3, "0")}-${remarkIndex + 1}` },
        update: {},
        create: {
          id: `demo-remark-${String(caseIndex + 1).padStart(3, "0")}-${remarkIndex + 1}`, claimCaseId: caseId, stage,
          content: stage === "acceptance" ? "受理资料已核对，身份及承保关系有效。" : stage === "calculation" ? "账单金额及责任匹配已复核。" : "审核关注赔付金额与既往累计情况。",
          createdAt: addDays(createdAt, remarkIndex),
        },
      });
    }

    if (status !== "registered" && !(status === "cancelled" && caseIndex % 2 === 0)) {
      const policyBenefits = benefitsByPolicy.get(policyInsured.policyId) ?? [];
      const selectedBenefits = policyBenefits.slice(0, Math.min(2, policyBenefits.length));
      const billCount = 1 + (caseIndex % 3);
      const calculationRows: Array<{ billId: string; invoiceNo: string; benefit: (typeof policyBenefits)[number]; amount: number; total: number; selfPaid: number }> = [];
      for (let billIndex = 0; billIndex < billCount; billIndex += 1) {
        const billId = `demo-bill-${String(caseIndex + 1).padStart(3, "0")}-${billIndex + 1}`;
        const invoiceNo = `INV${compactDate(safeReportDate)}${String(caseIndex + 1).padStart(3, "0")}${billIndex + 1}`;
        const total = 680 + caseIndex * 37 + billIndex * 460;
        const selfPaid = Number((total * (billIndex % 2 ? 0.08 : 0.04)).toFixed(2));
        const insuranceFund = Number((total * 0.35).toFixed(2));
        await prisma.claimBill.upsert({
          where: { id: billId },
          update: { totalAmount: total, diagnosis },
          create: {
            id: billId, claimCaseId: caseId, invoiceCode: `3100${caseIndex + 1}`, invoiceNo, checkCode: String(800000 + caseIndex * 10 + billIndex),
            billType: billIndex % 3 === 1 ? "2" : "1", patientName: person.name, patientIdNo: person.idNo ?? "", visitNo: `VISIT-${caseIndex + 1}-${billIndex + 1}`,
            institution: hospital, department: eventType === "2" ? "骨科" : "内科", billDate: addDays(safeReportDate, -1),
            admissionDate: billIndex % 3 === 1 ? addDays(safeReportDate, -5) : null, dischargeDate: billIndex % 3 === 1 ? addDays(safeReportDate, -1) : null,
            diagnosis, medicalInsuranceType: caseIndex % 5 === 0 ? "5" : "1", settlementNo: `SET-${caseIndex + 1}-${billIndex + 1}`, totalAmount: total, cashier: `收费员${(caseIndex % 5) + 1}`,
          },
        });
        const amounts = { "医保统筹支付": insuranceFund, "个人账户支付": total * 0.1, "个人现金支付": total - insuranceFund, "自费金额": selfPaid };
        for (const [amountName, amountValue] of Object.entries(amounts)) {
          await prisma.claimBillAmount.upsert({ where: { billId_amountName: { billId, amountName } }, update: { amountValue }, create: { billId, amountName, amountValue } });
        }
        for (const benefit of selectedBenefits) {
          await prisma.claimBillBenefit.upsert({ where: { billId_benefitId: { billId, benefitId: benefit.id } }, update: {}, create: { billId, benefitId: benefit.id } });
        }
        if (selectedBenefits[0]) calculationRows.push({ billId, invoiceNo, benefit: selectedBenefits[0], amount: Number(Math.max(0, (total - selfPaid - 300) * 0.9).toFixed(2)), total, selfPaid });
      }
      if (caseIndex % 3 === 0) {
        await prisma.claimCaseDiseaseEntry.upsert({
          where: { id: `demo-disease-${String(caseIndex + 1).padStart(3, "0")}` }, update: {},
          create: { id: `demo-disease-${String(caseIndex + 1).padStart(3, "0")}`, claimCaseId: caseId, diseaseName: diagnosis, icdCode: eventType === "2" ? "S93.4" : "J20.9", diagnosisDate: addDays(safeReportDate, -2), hospital, note: "场景数据疾病记录" },
        });
      }

      if (["calculating", "reviewing", "completed"].includes(status) && calculationRows.length) {
        const resultId = `demo-calc-result-${String(caseIndex + 1).padStart(3, "0")}`;
        const runNo = `CALDEMO${compactDate(safeReportDate)}${String(caseIndex + 1).padStart(3, "0")}`;
        const totalAmount = Number(calculationRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2));
        await prisma.claimCalculationRun.upsert({
          where: { runNo }, update: { totalAmount },
          create: { id: `demo-run-${String(caseIndex + 1).padStart(3, "0")}`, claimCaseId: caseId, runNo, status: "committed", totalAmount, resultData: { seeded: true, scenario: status }, committedAt: addDays(createdAt, 2), createdAt: addDays(createdAt, 2) },
        });
        await prisma.claimCaseCalculationResult.upsert({
          where: { runNo }, update: { totalAmount, billCount: calculationRows.length, responsibilityResultCount: calculationRows.length },
          create: { id: resultId, claimCaseId: caseId, runNo, policyId: policyInsured.policyId, insuredPersonId: policyInsured.insuredPersonId, totalAmount, billCount: calculationRows.length, responsibilityResultCount: calculationRows.length, createdAt: addDays(createdAt, 2) },
        });
        for (const [resultIndex, row] of calculationRows.entries()) {
          const billResultId = `demo-bill-result-${String(caseIndex + 1).padStart(3, "0")}-${resultIndex + 1}`;
          const afterDeductible = Number(Math.max(0, row.total - row.selfPaid - 300).toFixed(2));
          const substitutedResultExpression = `最小(${afterDeductible} * 90 / 100, 100000)`;
          await prisma.claimBillBenefitCalculationResult.upsert({
            where: { id: billResultId },
            update: { amount: row.amount },
            create: {
              id: billResultId, calculationResultId: resultId, claimCaseId: caseId, billId: row.billId, invoiceNo: row.invoiceNo,
              benefitId: row.benefit.id, benefitCode: row.benefit.benefitCode, benefitName: row.benefit.benefitName, formulaName: `${row.benefit.benefitName}自动理算`,
              sequenceNo: resultIndex + 1, matched: true, matchExpression: "医疗总费用 > 0", substitutedMatchExpression: `${row.total} > 0`, amount: row.amount, createdAt: addDays(createdAt, 2),
            },
          });
          await prisma.claimCalculationProcess.upsert({
            where: { id: `demo-process-${String(caseIndex + 1).padStart(3, "0")}-${resultIndex + 1}` }, update: { substitutedExpression: substitutedResultExpression, resultValue: row.amount },
            create: {
              id: `demo-process-${String(caseIndex + 1).padStart(3, "0")}-${resultIndex + 1}`, billBenefitResultId: billResultId,
              stepId: "result", stepName: "责任给付金额", sequenceNo: 1, expression: "最小(扣除免赔后金额 * 赔付比例 / 100, 限额)",
              substitutedExpression: substitutedResultExpression, resultFlag: true, resultValue: row.amount, ledgerTargetCode: "annual_payment", ledgerTargetName: "累计年给付金额",
              ledgerOpeningAmount: 0, ledgerClosingAmount: row.amount, createdAt: addDays(createdAt, 2),
            },
          });
          const scopeIds = [row.benefit.id, `product:${row.benefit.policyProductId}`, `plan:${policyInsured.coveragePlanId}`, `event:${eventId}`];
          for (const [scopeIndex, scopeId] of scopeIds.entries()) {
            const key = `${policyInsured.policyId}|${policyInsured.insuredPersonId}|${scopeId}|${safeReportDate.getUTCFullYear()}`;
            const current = ledgerTotals.get(key) ?? { policyId: policyInsured.policyId, personId: policyInsured.insuredPersonId, scopeId, amount: 0, year: safeReportDate.getUTCFullYear() };
            const before = current.amount;
            current.amount = Number((current.amount + row.amount).toFixed(2));
            ledgerTotals.set(key, current);
            await prisma.claimLedgerAccumulationRecord.upsert({
              where: { id: `demo-accum-${String(caseIndex + 1).padStart(3, "0")}-${resultIndex + 1}-${scopeIndex + 1}` }, update: { beforeAmount: before, accumulatedAmount: row.amount, afterAmount: current.amount },
              create: {
                id: `demo-accum-${String(caseIndex + 1).padStart(3, "0")}-${resultIndex + 1}-${scopeIndex + 1}`, calculationResultId: resultId, claimCaseId: caseId, billId: row.billId,
                policyId: current.policyId, insuredPersonId: current.personId, benefitId: current.scopeId, ledgerCode: "annual_payment", ledgerName: "累计年给付金额",
                periodYear: current.year, beforeAmount: before, accumulatedAmount: row.amount, afterAmount: current.amount, createdAt: addDays(createdAt, 2),
              },
            });
          }
        }
      }
    }
  }

  for (const [key, value] of ledgerTotals.entries()) {
    const ledgerId = `demo-ledger-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`;
    await prisma.claimLedgerCurrentValue.upsert({
      where: { policyId_insuredPersonId_benefitId_ledgerCode_periodYear: { policyId: value.policyId, insuredPersonId: value.personId, benefitId: value.scopeId, ledgerCode: "annual_payment", periodYear: value.year } },
      update: { currentAmount: value.amount },
      create: { id: ledgerId, policyId: value.policyId, insuredPersonId: value.personId, benefitId: value.scopeId, ledgerCode: "annual_payment", ledgerName: "累计年给付金额", periodYear: value.year, currentAmount: value.amount },
    });
  }

  console.log(`scenario seed completed: ${scenarioPolicies.length} policies, ${extraPeople.length} people, ${statuses.length} cases`);
}
