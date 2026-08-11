import { randomUUID } from "node:crypto";
import type { ClaimAttachment, ClaimAttachmentOcr, ClaimCase as DbClaimCase, ClaimEvent as DbClaimEvent, ClaimParty as DbClaimParty } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { requireClaimCaseEditable, requireClaimTransition, type ClaimDirectWorkflowAction } from "./state-machine.ts";
import type { ClaimCase, ClaimCaseStatus, ClaimEventInput, ClaimEventType, ClaimOcrResult, ClaimOperator, ClaimPartySnapshot, ClaimPersonEvent, ClaimRemarkStage, ClaimTransitionAction, ClaimUpload, CreateClaimCaseInput } from "./types.ts";

export const DEFAULT_CLAIM_OPERATOR: ClaimOperator = { userId: "default-user", userName: "默认用户" };

function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function optionalDate(value: string) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }

function mapEvent(item: DbClaimEvent): ClaimPersonEvent {
  return { ...item, eventType: item.eventType as ClaimEventType, occurredDate: dateOnly(item.occurredDate), detailedAddress: item.detailedAddress ?? undefined, hospitalName: item.hospitalName ?? undefined, diagnosis: item.diagnosis ?? undefined, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
}

function mapParty(item: DbClaimParty): ClaimPartySnapshot {
  return { role: item.role, name: item.name, gender: item.gender, birthDate: item.birthDate ? dateOnly(item.birthDate) : "", idType: item.idType, idNo: item.idNo, idValidFrom: item.idValidFrom ? dateOnly(item.idValidFrom) : "", idValidTo: item.idLongTerm ? "" : item.idValidTo ? dateOnly(item.idValidTo) : "", idLongTerm: item.idLongTerm, address: item.address ?? "", phone: item.phone, relationToInsured: item.relationToInsured ?? undefined, bankName: item.bankName ?? undefined, bankAccountName: item.bankAccountName ?? undefined, bankAccountNo: item.bankAccountNo ?? undefined, paymentMethod: item.paymentMethod ?? undefined };
}

function mapOcr(item: ClaimAttachmentOcr): ClaimOcrResult {
  return {
    status: item.status,
    documentType: item.documentType ?? undefined,
    classificationConfidence: item.classificationConfidence ?? undefined,
    text: item.rawText ?? undefined,
    lines: item.lines ? item.lines as unknown as ClaimOcrResult["lines"] : undefined,
    structuredData: item.structuredData ?? undefined,
    engine: item.engine ?? undefined,
    durationMs: item.durationMs ?? undefined,
    pageCount: item.pageCount ?? undefined,
    attempts: item.attempts,
    lastError: item.lastError ?? undefined,
    queuedAt: item.queuedAt.toISOString(),
    startedAt: item.startedAt?.toISOString(),
    completedAt: item.completedAt?.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function mapAttachment(item: ClaimAttachment, ocr?: ClaimAttachmentOcr): ClaimUpload {
  return {
    uploadId: item.uploadId,
    fileName: item.fileName,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    category: item.category,
    uploadedAt: item.createdAt.toISOString(),
    ocr: ocr ? mapOcr(ocr) : undefined,
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const values = grouped.get(key);
    if (values) values.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

async function hydrateCases(items: DbClaimCase[]): Promise<ClaimCase[]> {
  if (!items.length) return [];
  const caseIds = items.map((item) => item.id);
  const [parties, events, attachments, policies, remarks, transitions] = await Promise.all([
    prisma.claimParty.findMany({ where: { claimCaseId: { in: caseIds } }, orderBy: { createdAt: "asc" } }),
    prisma.claimEvent.findMany({ where: { id: { in: [...new Set(items.map((item) => item.eventId))] } } }),
    prisma.claimAttachment.findMany({ where: { claimCaseId: { in: caseIds } }, orderBy: { createdAt: "asc" } }),
    prisma.policy.findMany({ where: { id: { in: [...new Set(items.map((item) => item.policyId))] } }, select: { id: true, policyNo: true } }),
    prisma.claimCaseRemark.findMany({ where: { claimCaseId: { in: caseIds } }, orderBy: { createdAt: "desc" } }),
    prisma.claimCaseTransition.findMany({ where: { claimCaseId: { in: caseIds } }, orderBy: { occurredAt: "asc" } }),
  ]);
  const partiesByCase = groupBy(parties, (item) => item.claimCaseId);
  const attachmentsByCase = groupBy(attachments, (item) => item.claimCaseId);
  const remarksByCase = groupBy(remarks, (item) => item.claimCaseId);
  const transitionsByCase = groupBy(transitions, (item) => item.claimCaseId);
  const ocrItems = attachments.length
    ? await prisma.claimAttachmentOcr.findMany({ where: { uploadId: { in: attachments.map((item) => item.uploadId) } } })
    : [];
  const ocrByUploadId = new Map(ocrItems.map((item) => [item.uploadId, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const policyNoById = new Map(policies.map((item) => [item.id, item.policyNo]));
  return items.map((item) => {
    const event = eventById.get(item.eventId);
    if (!event) throw new Error("claim_event_not_found");
    return { id: item.id, caseNo: item.caseNo, policyId: item.policyId, policyNo: policyNoById.get(item.policyId) ?? "", policyInsuredId: item.policyInsuredId, insuredPersonId: item.insuredPersonId, reportDate: dateOnly(item.reportDate), reportChannel: item.reportChannel, status: item.status, currentHandlerUserId: item.currentHandlerUserId, currentHandlerName: item.currentHandlerName, remark: item.remark ?? undefined, remarks: (remarksByCase.get(item.id) ?? []).map((remark) => ({ ...remark, stage: remark.stage as ClaimRemarkStage, createdAt: remark.createdAt.toISOString() })), transitions: (transitionsByCase.get(item.id) ?? []).map((transition) => ({ ...transition, action: transition.action as ClaimTransitionAction, fromStatus: (transition.fromStatus as ClaimCaseStatus | null) ?? undefined, toStatus: transition.toStatus as ClaimCaseStatus, description: transition.description ?? undefined, occurredAt: transition.occurredAt.toISOString() })), parties: (partiesByCase.get(item.id) ?? []).map(mapParty), eventId: item.eventId, event: mapEvent(event), attachments: (attachmentsByCase.get(item.id) ?? []).map((attachment) => mapAttachment(attachment, ocrByUploadId.get(attachment.uploadId))), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  });
}

async function hydrateCase(item: DbClaimCase): Promise<ClaimCase> {
  return (await hydrateCases([item]))[0]!;
}

async function validateInput(input: CreateClaimCaseInput) {
  const [policy, policyInsured, event] = await Promise.all([
    prisma.policy.findUnique({ where: { id: input.policyId } }),
    prisma.policyInsured.findUnique({ where: { id: input.policyInsuredId } }),
    prisma.claimEvent.findUnique({ where: { id: input.eventId } }),
  ]);
  if (!policy) throw new Error("policy_not_found");
  if (!policyInsured || policyInsured.policyId !== policy.id) throw new Error("policy_insured_not_found");
  if (!event || event.insuredPersonId !== policyInsured.insuredPersonId) throw new Error("claim_event_not_found");
  const requiredRoles = ["insured", "applicant", "payee"];
  if (!requiredRoles.every((role) => input.parties.some((party) => party.role === role)) || input.parties.some((party) => !party.name.trim() || !party.idNo.trim() || !party.phone.trim())) throw new Error("claim_parties_incomplete");
  if (input.parties.some((party) => party.idLongTerm && Boolean(party.idValidTo))) throw new Error("claim_identity_validity_conflict");
  const payee = input.parties.find((party) => party.role === "payee");
  if (!payee?.paymentMethod) throw new Error("claim_payment_method_required");
  if (payee.paymentMethod === "bank_transfer" && (!payee.bankName?.trim() || !payee.bankAccountName?.trim() || !payee.bankAccountNo?.trim())) throw new Error("claim_bank_information_incomplete");
  return { policy, policyInsured };
}

function partyData(claimCaseId: string, party: ClaimPartySnapshot) {
  return { id: randomUUID(), claimCaseId, role: party.role, name: party.name.trim(), gender: party.gender, birthDate: optionalDate(party.birthDate), idType: party.idType, idNo: party.idNo.trim(), idValidFrom: optionalDate(party.idValidFrom), idValidTo: party.idLongTerm ? null : optionalDate(party.idValidTo), idLongTerm: party.idLongTerm, address: party.address?.trim() || null, phone: party.phone.trim(), relationToInsured: party.relationToInsured?.trim() || null, bankName: party.bankName?.trim() || null, bankAccountName: party.bankAccountName?.trim() || null, bankAccountNo: party.bankAccountNo?.trim() || null, paymentMethod: party.paymentMethod ?? null };
}

export async function listClaimCasesDb() {
  const items = await prisma.claimCase.findMany({ orderBy: { updatedAt: "desc" } });
  return hydrateCases(items);
}

export async function getClaimCaseStatusDb(id: string) {
  return prisma.claimCase.findUnique({ where: { id }, select: { status: true } }).then((item) => item?.status ?? null);
}

export async function queryClaimCasesDb(input: {
  id?: string;
  keyword?: string;
  caseNo?: string;
  policyNo?: string;
  insuredName?: string;
  insuredIdNo?: string;
  status?: ClaimCaseStatus | ClaimCaseStatus[];
  reportDateFrom?: string;
  reportDateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "updatedAt" | "reportDate" | "createdAt";
  sortOrder?: "asc" | "desc";
}) {
  const keyword = input.keyword?.trim();
  const caseNo = input.caseNo?.trim().toUpperCase();
  const policyNo = input.policyNo?.trim().toUpperCase();
  const insuredName = input.insuredName?.trim();
  const insuredIdNo = input.insuredIdNo?.trim().toUpperCase();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));

  const [policyIds, insuredPersonIds, keywordPolicyIds, keywordInsuredPersonIds, keywordEventIds] = await Promise.all([
    policyNo
      ? prisma.policy.findMany({ where: { policyNo: { equals: policyNo, mode: "insensitive" } }, select: { id: true } }).then((items) => items.map((item) => item.id))
      : Promise.resolve<string[] | undefined>(undefined),
    insuredName || insuredIdNo
      ? prisma.insuredPerson.findMany({ where: { name: insuredName ? { contains: insuredName, mode: "insensitive" } : undefined, idNo: insuredIdNo ? { equals: insuredIdNo, mode: "insensitive" } : undefined }, select: { id: true } }).then((items) => items.map((item) => item.id))
      : Promise.resolve<string[] | undefined>(undefined),
    keyword
      ? prisma.policy.findMany({ where: { policyNo: { contains: keyword, mode: "insensitive" } }, select: { id: true } }).then((items) => items.map((item) => item.id))
      : Promise.resolve<string[]>([]),
    keyword
      ? prisma.insuredPerson.findMany({ where: { OR: [{ name: { contains: keyword, mode: "insensitive" } }, { idNo: { contains: keyword, mode: "insensitive" } }] }, select: { id: true } }).then((items) => items.map((item) => item.id))
      : Promise.resolve<string[]>([]),
    keyword
      ? prisma.claimEvent.findMany({ where: { eventNo: { contains: keyword, mode: "insensitive" } }, select: { id: true } }).then((items) => items.map((item) => item.id))
      : Promise.resolve<string[]>([]),
  ]);

  if ((policyIds && policyIds.length === 0) || (insuredPersonIds && insuredPersonIds.length === 0)) {
    return { total: 0, page, pageSize, items: [] as ClaimCase[] };
  }

  const where = {
    id: input.id,
    caseNo: caseNo ? { equals: caseNo, mode: "insensitive" as const } : undefined,
    policyId: policyIds ? { in: policyIds } : undefined,
    insuredPersonId: insuredPersonIds ? { in: insuredPersonIds } : undefined,
    OR: keyword ? [
      { caseNo: { contains: keyword, mode: "insensitive" as const } },
      { policyId: { in: keywordPolicyIds } },
      { insuredPersonId: { in: keywordInsuredPersonIds } },
      { eventId: { in: keywordEventIds } },
    ] : undefined,
    status: Array.isArray(input.status) ? { in: input.status } : input.status,
    reportDate: input.reportDateFrom || input.reportDateTo ? {
      gte: input.reportDateFrom ? new Date(`${input.reportDateFrom}T00:00:00.000Z`) : undefined,
      lte: input.reportDateTo ? new Date(`${input.reportDateTo}T23:59:59.999Z`) : undefined,
    } : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.claimCase.count({ where }),
    prisma.claimCase.findMany({
      where,
      orderBy: { [input.sortBy ?? "updatedAt"]: input.sortOrder ?? "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, page, pageSize, items: await hydrateCases(rows) };
}

export async function createClaimCaseDb(input: CreateClaimCaseInput, operator: ClaimOperator = DEFAULT_CLAIM_OPERATOR) {
  const { policy, policyInsured } = await validateInput(input);
  const now = new Date(); const datePart = dateOnly(now).replaceAll("-", "");
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ locked: number }[]>`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${"claim_case:" + datePart}))`;
    const sequence = String(await tx.claimCase.count({ where: { caseNo: { startsWith: `CL${datePart}` } } }) + 1).padStart(4, "0");
    await tx.claimCase.create({ data: { id, caseNo: `CL${datePart}${sequence}`, policyId: policy.id, policyInsuredId: policyInsured.id, insuredPersonId: policyInsured.insuredPersonId, eventId: input.eventId, reportDate: new Date(`${input.reportDate}T00:00:00.000Z`), reportChannel: input.reportChannel, currentHandlerUserId: operator.userId, currentHandlerName: operator.userName, remark: input.remark?.trim() || null } });
    await tx.claimCaseTransition.create({ data: { id: randomUUID(), claimCaseId: id, action: "create", fromStatus: null, toStatus: "registered", operatorUserId: operator.userId, operatorName: operator.userName, targetUserId: operator.userId, targetUserName: operator.userName, description: "创建案件" } });
    if (input.remark?.trim()) await tx.claimCaseRemark.create({ data: { id: randomUUID(), claimCaseId: id, stage: "acceptance", content: input.remark.trim() } });
    await tx.claimParty.createMany({ data: input.parties.map((party) => partyData(id, party)) });
    if (input.attachments.length) await tx.claimAttachment.createMany({ data: input.attachments.map((item) => ({ id: randomUUID(), claimCaseId: id, uploadId: item.uploadId, category: item.category, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize })) });
  });
  return hydrateCase((await prisma.claimCase.findUnique({ where: { id } }))!);
}

export async function updateClaimCaseDb(id: string, input: CreateClaimCaseInput) {
  const current = await prisma.claimCase.findUnique({ where: { id } });
  if (!current) return null;
  requireClaimCaseEditable(current.status, "acceptance");
  const { policy, policyInsured } = await validateInput(input);
  await prisma.$transaction(async (tx) => {
    await tx.claimCase.update({ where: { id }, data: { policyId: policy.id, policyInsuredId: policyInsured.id, insuredPersonId: policyInsured.insuredPersonId, eventId: input.eventId, reportDate: new Date(`${input.reportDate}T00:00:00.000Z`), reportChannel: input.reportChannel, remark: input.remark?.trim() || null } });
    await tx.claimParty.deleteMany({ where: { claimCaseId: id } });
    await tx.claimParty.createMany({ data: input.parties.map((party) => partyData(id, party)) });
    await tx.claimAttachment.deleteMany({ where: { claimCaseId: id } });
    if (input.attachments.length) await tx.claimAttachment.createMany({ data: input.attachments.map((item) => ({ id: randomUUID(), claimCaseId: id, uploadId: item.uploadId, category: item.category, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize })) });
  });
  return hydrateCase((await prisma.claimCase.findUnique({ where: { id } }))!);
}

export async function transitionClaimCaseDb(id: string, action: ClaimDirectWorkflowAction, operator: ClaimOperator = DEFAULT_CLAIM_OPERATOR) {
  const current = await prisma.claimCase.findUnique({ where: { id } });
  if (!current) return null;
  const transition = requireClaimTransition(current.status, action);
  if (transition.executor !== "claims") throw new Error("claim_transition_executor_mismatch");
  const updated = await prisma.$transaction(async (tx) => {
    const submitted = action === "rollback"
      ? await tx.claimCaseTransition.findFirst({ where: { claimCaseId: id, toStatus: current.status }, orderBy: { occurredAt: "desc" } })
      : null;
    const target = submitted ? { userId: submitted.operatorUserId, userName: submitted.operatorName } : operator;
    const changed = await tx.claimCase.updateMany({ where: { id, status: transition.from }, data: { status: transition.to, currentHandlerUserId: target.userId, currentHandlerName: target.userName } });
    if (changed.count !== 1) throw new Error("claim_case_status_locked");
    await tx.claimCaseTransition.create({ data: { id: randomUUID(), claimCaseId: id, action: transition.transitionAction, fromStatus: transition.from, toStatus: transition.to, operatorUserId: operator.userId, operatorName: operator.userName, targetUserId: target.userId, targetUserName: target.userName, description: action === "rollback" ? `${transition.description}给提交人 ${target.userName}` : transition.description } });
    return (await tx.claimCase.findUnique({ where: { id } }))!;
  });
  return hydrateCase(updated);
}

export async function createClaimCaseRemarkDb(claimCaseId: string, stage: ClaimRemarkStage, content: string) {
  const claimCase = await prisma.claimCase.findUnique({ where: { id: claimCaseId }, select: { id: true } });
  if (!claimCase) throw new Error("claim_case_not_found");
  const trimmed = content.trim();
  if (!trimmed) throw new Error("claim_remark_content_required");
  const item = await prisma.claimCaseRemark.create({ data: { id: randomUUID(), claimCaseId, stage, content: trimmed } });
  return { ...item, stage: item.stage as ClaimRemarkStage, createdAt: item.createdAt.toISOString() };
}

export async function listClaimEventsDb(input: { insuredPersonId: string; keyword?: string; eventType?: string; occurredDate?: string }) {
  const keyword = input.keyword?.trim();
  const items = await prisma.claimEvent.findMany({ where: { insuredPersonId: input.insuredPersonId, eventType: input.eventType || undefined, occurredDate: input.occurredDate ? new Date(`${input.occurredDate}T00:00:00.000Z`) : undefined, OR: keyword ? [{ eventNo: { contains: keyword, mode: "insensitive" } }, { administrativeArea: { contains: keyword, mode: "insensitive" } }, { detailedAddress: { contains: keyword, mode: "insensitive" } }, { hospitalName: { contains: keyword, mode: "insensitive" } }, { diagnosis: { contains: keyword, mode: "insensitive" } }, { description: { contains: keyword, mode: "insensitive" } }] : undefined }, orderBy: { occurredDate: "desc" } });
  return items.map(mapEvent);
}

export async function createClaimEventDb(insuredPersonId: string, input: ClaimEventInput) {
  if (!insuredPersonId || !input.occurredDate || !input.description.trim()) throw new Error("claim_event_incomplete");
  if (!await prisma.insuredPerson.findUnique({ where: { id: insuredPersonId } })) throw new Error("insured_person_not_found");
  const datePart = input.occurredDate.replaceAll("-", "");
  return mapEvent(await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ locked: number }[]>`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${"claim_event:" + datePart}))`;
    const sequence = String(await tx.claimEvent.count({ where: { eventNo: { startsWith: `EV${datePart}` } } }) + 1).padStart(4, "0");
    return tx.claimEvent.create({ data: { id: randomUUID(), eventNo: `EV${datePart}${sequence}`, insuredPersonId, eventType: input.eventType, occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`), administrativeArea: input.administrativeArea?.trim() || "待补充", detailedAddress: input.detailedAddress?.trim() || null, hospitalName: input.hospitalName?.trim() || null, diagnosis: input.diagnosis?.trim() || null, description: input.description.trim() } });
  }));
}

export async function updateClaimEventDb(eventId: string, insuredPersonId: string, input: ClaimEventInput) {
  const current = await prisma.claimEvent.findFirst({ where: { id: eventId, insuredPersonId } });
  if (!current) throw new Error("claim_event_not_found");
  return mapEvent(await prisma.claimEvent.update({ where: { id: eventId }, data: { eventType: input.eventType, occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`), administrativeArea: input.administrativeArea?.trim() || "待补充", detailedAddress: input.detailedAddress?.trim() || null, hospitalName: input.hospitalName?.trim() || null, diagnosis: input.diagnosis?.trim() || null, description: input.description.trim() } }));
}
