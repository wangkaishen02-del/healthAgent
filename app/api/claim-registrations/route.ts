import { NextRequest, NextResponse } from "next/server";
import { changeClaimCaseStatusDb, createClaimCaseDb, listClaimCasesDb, updateClaimCaseDb } from "../../../src/claims/prisma-service";
import type { CreateClaimCaseInput } from "../../../src/claims/types";

function isCreateInput(value: unknown): value is CreateClaimCaseInput {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<CreateClaimCaseInput>;
  const validChannels = ["online", "phone", "counter", "other"];
  const validRoles = ["insured", "applicant", "payee"];
  return typeof body.policyId === "string"
    && typeof body.policyInsuredId === "string"
    && typeof body.eventId === "string"
    && typeof body.reportDate === "string"
    && validChannels.includes(body.reportChannel ?? "")
    && Array.isArray(body.parties)
    && body.parties.length === 3
    && body.parties.every((party) => Boolean(party)
      && validRoles.includes(party.role)
      && typeof party.name === "string"
      && typeof party.idNo === "string"
      && typeof party.phone === "string")
    && Array.isArray(body.attachments)
    && body.attachments.every((attachment) => typeof attachment?.uploadId === "string");
}

export async function GET() {
  return NextResponse.json({ items: await listClaimCasesDb() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!isCreateInput(body)) return NextResponse.json({ message: "invalid_claim_case" }, { status: 400 });
  try {
    return NextResponse.json(await createClaimCaseDb(body), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim_registration_failed";
    const status = message.endsWith("_not_found") ? 404 : 400;
    return NextResponse.json({ message }, { status });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as ({ id?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.id !== "string" || !isCreateInput(body)) {
    return NextResponse.json({ message: "invalid_claim_case" }, { status: 400 });
  }
  try {
    const result = await updateClaimCaseDb(body.id, body);
    return result ? NextResponse.json(result) : NextResponse.json({ message: "claim_case_not_found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim_update_failed";
    return NextResponse.json({ message }, { status: message.endsWith("_not_found") ? 404 : 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as { id?: unknown; action?: unknown } | null;
  if (!body || typeof body.id !== "string" || (body.action !== "submit" && body.action !== "cancel")) {
    return NextResponse.json({ message: "invalid_claim_action" }, { status: 400 });
  }
  try {
    const result = await changeClaimCaseStatusDb(body.id, body.action === "submit" ? "submitted" : "cancelled");
    return result ? NextResponse.json(result) : NextResponse.json({ message: "claim_case_not_found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim_status_update_failed";
    return NextResponse.json({ message }, { status: 409 });
  }
}
