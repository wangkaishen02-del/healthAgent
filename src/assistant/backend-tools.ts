import { prisma } from "../db/prisma.ts";
import { queryClaimCasesDb } from "../claims/prisma-service.ts";
import {
  CLAIM_CASE_STATUSES,
  CLAIM_STATUS_LABELS,
  CLAIM_TRANSITION_RULES,
  isClaimCaseEditable,
} from "../claims/state-machine.ts";
import type { ClaimCaseStatus } from "../claims/types.ts";
import { canAccessAssistantPage } from "./access-control.ts";

function canUseWorkflowRule(roles: readonly string[], requiredRoles: readonly string[]) {
  return roles.includes("claim_admin") || requiredRoles.some((role) => roles.includes(role));
}

function recommendedPage(status: ClaimCaseStatus) {
  if (status === "registered") return "claim_registration";
  if (status === "entering" || status === "calculating") return "claim_entry_calculation";
  if (status === "reviewing" || status === "completed") return "claim_review_completion";
  return "claim_query";
}

export async function inspectClaimCaseForAssistant(caseNo: string, roles: readonly string[] = []) {
  const result = await queryClaimCasesDb({ caseNo, page: 1, pageSize: 2 });
  if (result.total === 0) return { type: "claim_case_inspection", found: false, caseNo };
  if (result.total !== 1) return { type: "claim_case_inspection", found: false, ambiguous: true, caseNo, total: result.total };

  const claimCase = result.items[0]!;
  const [billCount, diseaseCount, calculationResult] = await Promise.all([
    prisma.claimBill.count({ where: { claimCaseId: claimCase.id } }),
    prisma.claimCaseDiseaseEntry.count({ where: { claimCaseId: claimCase.id } }),
    prisma.claimCaseCalculationResult.findFirst({
      where: { claimCaseId: claimCase.id },
      orderBy: { createdAt: "desc" },
      select: { totalAmount: true, billCount: true, responsibilityResultCount: true, createdAt: true },
    }),
  ]);

  const requiredPartyRoles = ["insured", "applicant", "payee"] as const;
  const presentPartyRoles = new Set(claimCase.parties.map((party) => party.role));
  const missingPartyRoles = requiredPartyRoles.filter((role) => !presentPartyRoles.has(role));
  const payee = claimCase.parties.find((party) => party.role === "payee");
  const ocrStatusCounts = claimCase.attachments.reduce<Record<string, number>>((counts, attachment) => {
    const status = attachment.ocr?.status ?? "not_queued";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const warnings: string[] = [];
  if (missingPartyRoles.length) warnings.push(`缺少关系人：${missingPartyRoles.join("、")}`);
  if (!payee?.paymentMethod || payee.paymentMethod === "pending") warnings.push("领款方式尚未确定");
  if (payee?.paymentMethod === "bank_transfer" && (!payee.bankName || !payee.bankAccountName || !payee.bankAccountNo)) warnings.push("领款银行信息不完整");
  if (claimCase.status === "entering" && billCount === 0) warnings.push("尚未录入账单，暂不能完成理算");
  if ((claimCase.status === "calculating" || claimCase.status === "reviewing" || claimCase.status === "completed") && !calculationResult) warnings.push("案件状态显示已理算，但未找到理算结果");
  if ((ocrStatusCounts.failed ?? 0) > 0) warnings.push(`${ocrStatusCounts.failed} 个影像件 OCR 失败`);
  if ((ocrStatusCounts.queued ?? 0) + (ocrStatusCounts.processing ?? 0) > 0) warnings.push("仍有影像件正在等待或执行 OCR");

  const workflowActions = CLAIM_TRANSITION_RULES
    .filter((rule) => rule.from === claimCase.status && canUseWorkflowRule(roles, rule.roles))
    .map((rule) => ({ action: rule.action, label: rule.description, toStatus: rule.to, toStatusLabel: CLAIM_STATUS_LABELS[rule.to] }));
  const insured = claimCase.parties.find((party) => party.role === "insured");

  return {
    type: "claim_case_inspection",
    found: true,
    itemId: claimCase.id,
    caseNo: claimCase.caseNo,
    policyNo: claimCase.policyNo,
    status: claimCase.status,
    statusLabel: CLAIM_STATUS_LABELS[claimCase.status],
    currentHandler: claimCase.currentHandlerName,
    insuredName: insured?.name,
    insuredIdNo: insured?.idNo,
    event: {
      eventNo: claimCase.event.eventNo,
      eventType: claimCase.event.eventType,
      occurredDate: claimCase.event.occurredDate,
      diagnosis: claimCase.event.diagnosis,
    },
    dataSummary: {
      partyRoles: [...presentPartyRoles],
      remarkCount: claimCase.remarks?.length ?? 0,
      attachmentCount: claimCase.attachments.length,
      ocrStatusCounts,
      billCount,
      diseaseCount,
      calculation: calculationResult ? {
        totalAmount: Number(calculationResult.totalAmount),
        billCount: calculationResult.billCount,
        responsibilityResultCount: calculationResult.responsibilityResultCount,
        createdAt: calculationResult.createdAt.toISOString(),
      } : null,
    },
    editableAreas: {
      acceptance: isClaimCaseEditable(claimCase.status, "acceptance"),
      calculation: isClaimCaseEditable(claimCase.status, "calculation"),
    },
    warnings,
    workflowActions,
    recommendedPage: canAccessAssistantPage(recommendedPage(claimCase.status), roles)
      ? recommendedPage(claimCase.status)
      : "claim_query",
    resolvedFields: ["caseId", "caseNo", "policyNo", "insuredName", "insuredIdNo", "eventId"],
  };
}

export async function summarizeClaimWorkQueueForAssistant() {
  const [caseGroups, ocrGroups] = await Promise.all([
    prisma.claimCase.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.claimAttachmentOcr.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const caseCountByStatus = new Map(caseGroups.map((item) => [item.status, item._count._all]));
  const ocrCountByStatus = new Map(ocrGroups.map((item) => [item.status, item._count._all]));
  const stages = CLAIM_CASE_STATUSES.map((status) => ({
    status,
    label: CLAIM_STATUS_LABELS[status],
    count: caseCountByStatus.get(status) ?? 0,
  }));
  const activeTotal = stages
    .filter((item) => item.status !== "completed" && item.status !== "cancelled")
    .reduce((sum, item) => sum + item.count, 0);
  return {
    type: "claim_work_queue_summary",
    total: stages.reduce((sum, item) => sum + item.count, 0),
    activeTotal,
    stages,
    ocr: {
      queued: ocrCountByStatus.get("queued") ?? 0,
      processing: ocrCountByStatus.get("processing") ?? 0,
      succeeded: ocrCountByStatus.get("succeeded") ?? 0,
      failed: ocrCountByStatus.get("failed") ?? 0,
    },
  };
}
