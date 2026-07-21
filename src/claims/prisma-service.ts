import { randomUUID } from "node:crypto";
import type { ClaimAttachment, ClaimCase as DbClaimCase, ClaimEvent as DbClaimEvent, ClaimParty as DbClaimParty } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import type { ClaimCase, ClaimCaseStatus, ClaimEventInput, ClaimPartySnapshot, ClaimPersonEvent, ClaimUpload, CreateClaimCaseInput } from "./types.ts";

function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function optionalDate(value: string) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }

function mapEvent(item: DbClaimEvent): ClaimPersonEvent {
  return { ...item, occurredDate: dateOnly(item.occurredDate), detailedAddress: item.detailedAddress ?? undefined, hospitalName: item.hospitalName ?? undefined, diagnosis: item.diagnosis ?? undefined, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
}

function mapParty(item: DbClaimParty): ClaimPartySnapshot {
  return { role: item.role, name: item.name, gender: item.gender, birthDate: item.birthDate ? dateOnly(item.birthDate) : "", idType: item.idType, idNo: item.idNo, idValidFrom: item.idValidFrom ? dateOnly(item.idValidFrom) : "", idValidTo: item.idValidTo ? dateOnly(item.idValidTo) : "", idLongTerm: item.idLongTerm, address: item.address ?? "", phone: item.phone, relationToInsured: item.relationToInsured ?? undefined, bankName: item.bankName ?? undefined, bankAccountName: item.bankAccountName ?? undefined, bankAccountNo: item.bankAccountNo ?? undefined, paymentMethod: item.paymentMethod ?? undefined };
}

function mapAttachment(item: ClaimAttachment): ClaimUpload {
  return { uploadId: item.uploadId, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize, category: item.category, uploadedAt: item.createdAt.toISOString() };
}

async function hydrateCase(item: DbClaimCase): Promise<ClaimCase> {
  const [parties, event, attachments] = await Promise.all([
    prisma.claimParty.findMany({ where: { claimCaseId: item.id }, orderBy: { createdAt: "asc" } }),
    prisma.claimEvent.findUnique({ where: { id: item.eventId } }),
    prisma.claimAttachment.findMany({ where: { claimCaseId: item.id }, orderBy: { createdAt: "asc" } }),
  ]);
  if (!event) throw new Error("claim_event_not_found");
  return { id: item.id, caseNo: item.caseNo, policyId: item.policyId, policyNo: (await prisma.policy.findUnique({ where: { id: item.policyId }, select: { policyNo: true } }))?.policyNo ?? "", policyInsuredId: item.policyInsuredId, insuredPersonId: item.insuredPersonId, reportDate: dateOnly(item.reportDate), reportChannel: item.reportChannel, status: item.status, remark: item.remark ?? undefined, parties: parties.map(mapParty), eventId: item.eventId, event: mapEvent(event), attachments: attachments.map(mapAttachment), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
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
  const payee = input.parties.find((party) => party.role === "payee");
  if (!payee?.paymentMethod) throw new Error("claim_payment_method_required");
  if (payee.paymentMethod === "bank_transfer" && (!payee.bankName?.trim() || !payee.bankAccountName?.trim() || !payee.bankAccountNo?.trim())) throw new Error("claim_bank_information_incomplete");
  return { policy, policyInsured };
}

function partyData(claimCaseId: string, party: ClaimPartySnapshot) {
  return { id: randomUUID(), claimCaseId, role: party.role, name: party.name.trim(), gender: party.gender, birthDate: optionalDate(party.birthDate), idType: party.idType, idNo: party.idNo.trim(), idValidFrom: optionalDate(party.idValidFrom), idValidTo: optionalDate(party.idValidTo), idLongTerm: party.idLongTerm, address: party.address?.trim() || null, phone: party.phone.trim(), relationToInsured: party.relationToInsured?.trim() || null, bankName: party.bankName?.trim() || null, bankAccountName: party.bankAccountName?.trim() || null, bankAccountNo: party.bankAccountNo?.trim() || null, paymentMethod: party.paymentMethod ?? null };
}

export async function listClaimCasesDb() {
  const items = await prisma.claimCase.findMany({ orderBy: { updatedAt: "desc" } });
  return Promise.all(items.map(hydrateCase));
}

export async function createClaimCaseDb(input: CreateClaimCaseInput) {
  const { policy, policyInsured } = await validateInput(input);
  const now = new Date(); const datePart = dateOnly(now).replaceAll("-", "");
  const sequence = String(await prisma.claimCase.count({ where: { caseNo: { startsWith: `CL${datePart}` } } }) + 1).padStart(4, "0");
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.claimCase.create({ data: { id, caseNo: `CL${datePart}${sequence}`, policyId: policy.id, policyInsuredId: policyInsured.id, insuredPersonId: policyInsured.insuredPersonId, eventId: input.eventId, reportDate: new Date(`${input.reportDate}T00:00:00.000Z`), reportChannel: input.reportChannel, remark: input.remark?.trim() || null } });
    await tx.claimParty.createMany({ data: input.parties.map((party) => partyData(id, party)) });
    if (input.attachments.length) await tx.claimAttachment.createMany({ data: input.attachments.map((item) => ({ id: randomUUID(), claimCaseId: id, uploadId: item.uploadId, category: item.category, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize })) });
  });
  return hydrateCase((await prisma.claimCase.findUnique({ where: { id } }))!);
}

export async function updateClaimCaseDb(id: string, input: CreateClaimCaseInput) {
  const current = await prisma.claimCase.findUnique({ where: { id } });
  if (!current) return null;
  if (current.status !== "registered") throw new Error("claim_case_not_editable");
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

export async function changeClaimCaseStatusDb(id: string, status: ClaimCaseStatus) {
  const current = await prisma.claimCase.findUnique({ where: { id } });
  if (!current) return null;
  if (current.status !== "registered") throw new Error("claim_case_status_locked");
  return hydrateCase(await prisma.claimCase.update({ where: { id }, data: { status } }));
}

export async function listClaimEventsDb(input: { insuredPersonId: string; keyword?: string; eventType?: string; occurredDate?: string }) {
  const keyword = input.keyword?.trim();
  const items = await prisma.claimEvent.findMany({ where: { insuredPersonId: input.insuredPersonId, eventType: input.eventType ? input.eventType as "disease" | "accident" | "other" : undefined, occurredDate: input.occurredDate ? new Date(`${input.occurredDate}T00:00:00.000Z`) : undefined, OR: keyword ? [{ eventNo: { contains: keyword, mode: "insensitive" } }, { administrativeArea: { contains: keyword, mode: "insensitive" } }, { detailedAddress: { contains: keyword, mode: "insensitive" } }, { hospitalName: { contains: keyword, mode: "insensitive" } }, { diagnosis: { contains: keyword, mode: "insensitive" } }, { description: { contains: keyword, mode: "insensitive" } }] : undefined }, orderBy: { occurredDate: "desc" } });
  return items.map(mapEvent);
}

export async function createClaimEventDb(insuredPersonId: string, input: ClaimEventInput) {
  if (!insuredPersonId || !input.occurredDate || !input.description.trim()) throw new Error("claim_event_incomplete");
  if (!await prisma.insuredPerson.findUnique({ where: { id: insuredPersonId } })) throw new Error("insured_person_not_found");
  const datePart = input.occurredDate.replaceAll("-", "");
  const sequence = String(await prisma.claimEvent.count({ where: { eventNo: { startsWith: `EV${datePart}` } } }) + 1).padStart(4, "0");
  return mapEvent(await prisma.claimEvent.create({ data: { id: randomUUID(), eventNo: `EV${datePart}${sequence}`, insuredPersonId, eventType: input.eventType, occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`), administrativeArea: input.administrativeArea?.trim() || "待补充", detailedAddress: input.detailedAddress?.trim() || null, hospitalName: input.hospitalName?.trim() || null, diagnosis: input.diagnosis?.trim() || null, description: input.description.trim() } }));
}

export async function updateClaimEventDb(eventId: string, insuredPersonId: string, input: ClaimEventInput) {
  const current = await prisma.claimEvent.findFirst({ where: { id: eventId, insuredPersonId } });
  if (!current) throw new Error("claim_event_not_found");
  return mapEvent(await prisma.claimEvent.update({ where: { id: eventId }, data: { eventType: input.eventType, occurredDate: new Date(`${input.occurredDate}T00:00:00.000Z`), administrativeArea: input.administrativeArea?.trim() || "待补充", detailedAddress: input.detailedAddress?.trim() || null, hospitalName: input.hospitalName?.trim() || null, diagnosis: input.diagnosis?.trim() || null, description: input.description.trim() } }));
}
