import { NextRequest, NextResponse } from "next/server";
import { listPolicyInsuredsDb } from "../../../../../src/underwriting/prisma-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await context.params;
  const { searchParams } = new URL(request.url);
  const result = await listPolicyInsuredsDb(policyId, {
    coveragePlanId: searchParams.get("coveragePlanId") ?? undefined,
    insuredName: searchParams.get("insuredName") ?? undefined,
    insuredIdNo: searchParams.get("insuredIdNo") ?? undefined,
    page: Number(searchParams.get("page") ?? 1),
    pageSize: Number(searchParams.get("pageSize") ?? 10),
  });

  if (!result) return NextResponse.json({ message: "Not Found" }, { status: 404 });
  return NextResponse.json(result);
}
