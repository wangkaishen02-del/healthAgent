import type { Gender } from "../underwriting/types.ts";

export type ClaimCaseStatus = "registered" | "submitted" | "cancelled";
export type ClaimPartyRole = "insured" | "applicant" | "payee";
export type ClaimEventType = "disease" | "accident" | "other";
export type ClaimReportChannel = "online" | "phone" | "counter" | "other";
export type ClaimAttachmentCategory = "application" | "identity" | "medical" | "invoice" | "bank" | "other";
export type ClaimPaymentMethod = "pending" | "bank_transfer" | "cash" | "other";

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
  remark?: string;
  parties: ClaimPartySnapshot[];
  eventId: string;
  event: ClaimPersonEvent;
  attachments: ClaimUpload[];
  createdAt: string;
  updatedAt: string;
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
