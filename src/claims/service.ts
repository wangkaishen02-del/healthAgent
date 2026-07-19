import { randomUUID } from "node:crypto";
import { policies, policyInsureds } from "../underwriting/mock-data.ts";
import type { ClaimAttachmentCategory, ClaimCase, ClaimCaseStatus, ClaimEventInput, ClaimPersonEvent, ClaimUpload, CreateClaimCaseInput } from "./types.ts";

const claimCases: ClaimCase[] = [];
const claimEvents: ClaimPersonEvent[] = [
  {
    id: "8c3ad5e2-4d8f-4c19-9f82-2c7fd4f80f01",
    eventNo: "EV202606120001",
    insuredPersonId: "insured-001",
    eventType: "disease",
    occurredDate: "2026-06-12",
    administrativeArea: "上海市 / 上海市 / 黄浦区",
    detailedAddress: "中山东一路附近",
    hospitalName: "上海市第一人民医院",
    diagnosis: "急性上呼吸道感染",
    description: "发热咳嗽后前往门诊就医。",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
  },
  {
    id: "8c3ad5e2-4d8f-4c19-9f82-2c7fd4f80f02",
    eventNo: "EV202604080001",
    insuredPersonId: "insured-001",
    eventType: "accident",
    occurredDate: "2026-04-08",
    administrativeArea: "上海市 / 上海市 / 徐汇区",
    detailedAddress: "漕溪北路附近",
    diagnosis: "踝关节扭伤",
    description: "步行时不慎扭伤，完成门诊检查。",
    createdAt: "2026-04-08T09:00:00.000Z",
    updatedAt: "2026-04-08T09:00:00.000Z",
  },
];
const uploadedFiles = new Map<string, { data: Uint8Array; upload: ClaimUpload }>();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function storeClaimUpload(input: {
  fileName: string;
  mimeType: string;
  data: Uint8Array;
  category: ClaimAttachmentCategory;
}) {
  if (!allowedMimeTypes.has(input.mimeType)) throw new Error("unsupported_file_type");
  if (!input.data.byteLength || input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("invalid_file_size");
  const upload: ClaimUpload = {
    uploadId: randomUUID(),
    fileName: input.fileName.slice(0, 200),
    mimeType: input.mimeType,
    fileSize: input.data.byteLength,
    category: input.category,
    uploadedAt: new Date().toISOString(),
  };
  uploadedFiles.set(upload.uploadId, { data: input.data, upload });
  return upload;
}

export function removeClaimUpload(uploadId: string) {
  return uploadedFiles.delete(uploadId);
}

function validateClaimInput(input: CreateClaimCaseInput) {
  const policy = policies.find((item) => item.id === input.policyId);
  if (!policy) throw new Error("policy_not_found");
  const policyInsured = policyInsureds.find((item) =>
    item.id === input.policyInsuredId && item.policyId === input.policyId,
  );
  if (!policyInsured) throw new Error("policy_insured_not_found");
  const requiredRoles = ["insured", "applicant", "payee"];
  if (!requiredRoles.every((role) => input.parties.some((party) => party.role === role))) {
    throw new Error("claim_parties_incomplete");
  }
  if (input.parties.some((party) => !party.name.trim() || !party.idNo.trim() || !party.phone.trim())) {
    throw new Error("claim_parties_incomplete");
  }
  const payee = input.parties.find((party) => party.role === "payee");
  if (!payee?.paymentMethod) throw new Error("claim_payment_method_required");
  if (payee.paymentMethod === "bank_transfer" && (!payee.bankName?.trim() || !payee.bankAccountName?.trim() || !payee.bankAccountNo?.trim())) {
    throw new Error("claim_bank_information_incomplete");
  }
  const event = claimEvents.find((item) => item.id === input.eventId && item.insuredPersonId === policyInsured.insuredPersonId);
  if (!event) throw new Error("claim_event_not_found");
  if (input.attachments.some((item) => !uploadedFiles.has(item.uploadId))) throw new Error("claim_upload_not_found");
  return { policy, policyInsured, event };
}

export function listClaimEvents(input: { insuredPersonId: string; keyword?: string; eventType?: string; occurredDate?: string }) {
  const keyword = input.keyword?.trim().toLowerCase() ?? "";
  return claimEvents
    .filter((item) => item.insuredPersonId === input.insuredPersonId)
    .filter((item) => !input.eventType || item.eventType === input.eventType)
    .filter((item) => !input.occurredDate || item.occurredDate === input.occurredDate)
    .filter((item) => !keyword || [item.eventNo, item.administrativeArea, item.detailedAddress, item.hospitalName, item.diagnosis, item.description].some((value) => value?.toLowerCase().includes(keyword)))
    .sort((a, b) => b.occurredDate.localeCompare(a.occurredDate));
}

export function createClaimEvent(insuredPersonId: string, input: ClaimEventInput) {
  if (!insuredPersonId || !input.occurredDate || !input.description.trim()) throw new Error("claim_event_incomplete");
  const now = new Date().toISOString();
  const datePart = input.occurredDate.replaceAll("-", "");
  const sequence = String(claimEvents.filter((item) => item.eventNo.startsWith(`EV${datePart}`)).length + 1).padStart(4, "0");
  const event: ClaimPersonEvent = { id: randomUUID(), eventNo: `EV${datePart}${sequence}`, insuredPersonId, ...input, administrativeArea: input.administrativeArea?.trim() || "待补充", detailedAddress: input.detailedAddress?.trim(), createdAt: now, updatedAt: now };
  claimEvents.push(event);
  return event;
}

export function updateClaimEvent(eventId: string, insuredPersonId: string, input: ClaimEventInput) {
  if (!eventId || !insuredPersonId || !input.occurredDate || !input.description.trim()) throw new Error("claim_event_incomplete");
  const index = claimEvents.findIndex((item) => item.id === eventId && item.insuredPersonId === insuredPersonId);
  if (index < 0) throw new Error("claim_event_not_found");
  const current = claimEvents[index];
  const updated: ClaimPersonEvent = {
    ...current,
    ...input,
    administrativeArea: input.administrativeArea?.trim() || "待补充",
    detailedAddress: input.detailedAddress?.trim(),
    updatedAt: new Date().toISOString(),
  };
  claimEvents[index] = updated;
  claimCases.forEach((claimCase) => {
    if (claimCase.eventId !== eventId) return;
    claimCase.event = { ...updated };
    claimCase.updatedAt = updated.updatedAt;
  });
  return updated;
}

export function createClaimCase(input: CreateClaimCaseInput) {
  const { policy, policyInsured, event } = validateClaimInput(input);

  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const sequence = String(claimCases.filter((item) => item.caseNo.startsWith(`CL${datePart}`)).length + 1).padStart(4, "0");
  const claimCase: ClaimCase = {
    id: randomUUID(),
    caseNo: `CL${datePart}${sequence}`,
    policyId: policy.id,
    policyNo: policy.policyNo,
    policyInsuredId: policyInsured.id,
    insuredPersonId: policyInsured.insuredPersonId,
    reportDate: input.reportDate,
    reportChannel: input.reportChannel,
    status: "registered",
    remark: input.remark?.trim() || undefined,
    parties: input.parties.map((party) => ({ ...party })),
    eventId: event.id,
    event: { ...event },
    attachments: input.attachments.map((item) => ({ ...item })),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  claimCases.push(claimCase);
  return claimCase;
}

export function updateClaimCase(id: string, input: CreateClaimCaseInput) {
  const index = claimCases.findIndex((item) => item.id === id);
  if (index < 0) return null;
  if (claimCases[index].status !== "registered") throw new Error("claim_case_not_editable");
  const { policy, policyInsured, event } = validateClaimInput(input);
  const updated: ClaimCase = {
    ...claimCases[index],
    policyId: policy.id,
    policyNo: policy.policyNo,
    policyInsuredId: policyInsured.id,
    insuredPersonId: policyInsured.insuredPersonId,
    reportDate: input.reportDate,
    reportChannel: input.reportChannel,
    remark: input.remark?.trim() || undefined,
    parties: input.parties.map((party) => ({ ...party })),
    eventId: event.id,
    event: { ...event },
    attachments: input.attachments.map((item) => ({ ...item })),
    updatedAt: new Date().toISOString(),
  };
  claimCases[index] = updated;
  return updated;
}

export function changeClaimCaseStatus(id: string, status: Extract<ClaimCaseStatus, "submitted" | "cancelled">) {
  const index = claimCases.findIndex((item) => item.id === id);
  if (index < 0) return null;
  if (claimCases[index].status !== "registered") throw new Error("claim_case_status_locked");
  claimCases[index] = { ...claimCases[index], status, updatedAt: new Date().toISOString() };
  return claimCases[index];
}

export function listClaimCases() {
  return [...claimCases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
