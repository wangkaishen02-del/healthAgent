import type { ClaimEventInput, CreateClaimCaseInput } from "../../../../src/claims/types.ts";

export function isClaimCaseInput(value: unknown): value is CreateClaimCaseInput {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<CreateClaimCaseInput>;
  return typeof body.policyId === "string"
    && typeof body.policyInsuredId === "string"
    && typeof body.eventId === "string"
    && typeof body.reportDate === "string"
    && ["online", "phone", "counter", "other"].includes(body.reportChannel ?? "")
    && Array.isArray(body.parties)
    && body.parties.length === 3
    && body.parties.every((party) => Boolean(party)
      && ["insured", "applicant", "payee"].includes(party.role)
      && typeof party.name === "string"
      && typeof party.idNo === "string"
      && typeof party.phone === "string")
    && Array.isArray(body.attachments)
    && body.attachments.every((attachment) => typeof attachment?.uploadId === "string");
}

export function isClaimEventInput(value: unknown): value is ClaimEventInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ClaimEventInput>;
  return ["1", "2", "9"].includes(input.eventType ?? "")
    && typeof input.occurredDate === "string"
    && typeof input.administrativeArea === "string"
    && typeof input.description === "string";
}
