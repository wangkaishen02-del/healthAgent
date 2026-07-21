import { NextRequest, NextResponse } from "next/server";
import { createClaimEventDb, listClaimEventsDb, updateClaimEventDb } from "../../../src/claims/prisma-service";
import type { ClaimEventInput } from "../../../src/claims/types";

function isEventInput(value: unknown): value is ClaimEventInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ClaimEventInput>;
  return ["disease", "accident", "other"].includes(input.eventType ?? "")
    && typeof input.occurredDate === "string"
    && typeof input.administrativeArea === "string"
    && typeof input.description === "string";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const insuredPersonId = params.get("insuredPersonId") ?? "";
  if (!insuredPersonId) return NextResponse.json({ message: "insured_person_required" }, { status: 400 });
  return NextResponse.json({ items: await listClaimEventsDb({
    insuredPersonId,
    keyword: params.get("keyword") ?? undefined,
    eventType: params.get("eventType") ?? undefined,
    occurredDate: params.get("occurredDate") ?? undefined,
  }) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as ({ insuredPersonId?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.insuredPersonId !== "string" || !isEventInput(body)) return NextResponse.json({ message: "invalid_claim_event" }, { status: 400 });
  try {
    return NextResponse.json(await createClaimEventDb(body.insuredPersonId, body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "claim_event_create_failed" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as ({ id?: unknown; insuredPersonId?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.id !== "string" || typeof body.insuredPersonId !== "string" || !isEventInput(body)) {
    return NextResponse.json({ message: "invalid_claim_event" }, { status: 400 });
  }
  try {
    return NextResponse.json(await updateClaimEventDb(body.id, body.insuredPersonId, body));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "claim_event_update_failed" }, { status: 400 });
  }
}
