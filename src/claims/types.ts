import type { Gender } from "../underwriting/types.ts";

export type ClaimCaseStatus = "registered" | "entering" | "calculating" | "reviewing" | "completed" | "cancelled";
export type ClaimPartyRole = "insured" | "applicant" | "payee";
export type ClaimEventType = "1" | "2" | "9";
export type ClaimReportChannel = "online" | "phone" | "counter" | "other";
export type ClaimAttachmentCategory = "application" | "identity" | "medical" | "invoice" | "bank" | "other";
export type ClaimPaymentMethod = "pending" | "bank_transfer" | "cash" | "other";
export type ClaimOcrStatus = "queued" | "processing" | "succeeded" | "failed";

export interface ClaimOcrLine {
  text: string;
  confidence: number;
  page: number;
  box: number[][];
}

export interface ClaimOcrResult {
  status: ClaimOcrStatus;
  documentType?: string;
  classificationConfidence?: number;
  text?: string;
  lines?: ClaimOcrLine[];
  structuredData?: unknown;
  engine?: string;
  durationMs?: number;
  pageCount?: number;
  attempts: number;
  lastError?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface ClaimPartySnapshot {
  role: ClaimPartyRole;
  name: string;
  gender: Gender;
  birthDate: string;
  idType: "id_card" | "passport" | "other";
  idNo: string;
  idValidFrom: string;
  idValidTo: string;
  idLongTerm: boolean;
  address: string;
  phone: string;
  relationToInsured?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  paymentMethod?: ClaimPaymentMethod;
}

export interface ClaimEventInput {
  eventType: ClaimEventType;
  occurredDate: string;
  administrativeArea?: string;
  detailedAddress?: string;
  hospitalName?: string;
  diagnosis?: string;
  description: string;
}

export interface ClaimPersonEvent extends ClaimEventInput {
  id: string;
  eventNo: string;
  insuredPersonId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimUpload {
  uploadId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: ClaimAttachmentCategory;
  uploadedAt: string;
  ocr?: ClaimOcrResult;
}

export interface ClaimCase {
  id: string;
  caseNo: string;
  policyId: string;
  policyNo: string;
  policyInsuredId: string;
  insuredPersonId: string;
  reportDate: string;
  reportChannel: ClaimReportChannel;
  status: ClaimCaseStatus;
  currentHandlerUserId: string;
  currentHandlerName: string;
  remark?: string;
  remarks?: ClaimCaseRemark[];
  transitions?: ClaimCaseTransition[];
  parties: ClaimPartySnapshot[];
  eventId: string;
  event: ClaimPersonEvent;
  attachments: ClaimUpload[];
  createdAt: string;
  updatedAt: string;
}

export type ClaimRemarkStage = "acceptance" | "calculation" | "review";

export interface ClaimCaseRemark {
  id: string;
  claimCaseId: string;
  stage: ClaimRemarkStage;
  content: string;
  createdAt: string;
}

export type ClaimTransitionAction = "create" | "submit" | "calculate" | "rollback" | "rollback_calculation" | "submit_review" | "complete" | "cancel" | "legacy_import";

export interface ClaimCaseTransition {
  id: string;
  claimCaseId: string;
  action: ClaimTransitionAction;
  fromStatus?: ClaimCaseStatus;
  toStatus: ClaimCaseStatus;
  operatorUserId: string;
  operatorName: string;
  targetUserId: string;
  targetUserName: string;
  description?: string;
  occurredAt: string;
}

export interface ClaimOperator {
  userId: string;
  userName: string;
}

export interface CreateClaimCaseInput {
  policyId: string;
  policyInsuredId: string;
  reportDate: string;
  reportChannel: ClaimReportChannel;
  remark?: string;
  parties: ClaimPartySnapshot[];
  eventId: string;
  attachments: ClaimUpload[];
}
