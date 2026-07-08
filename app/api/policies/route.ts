import { NextRequest, NextResponse } from "next/server";
import { listPolicies } from "../../../src/underwriting/service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const items = listPolicies({
    policyNo: searchParams.get("policyNo") ?? undefined,
    applicantName: searchParams.get("applicantName") ?? undefined,
    insuredName: searchParams.get("insuredName") ?? undefined,
    insuredIdNo: searchParams.get("insuredIdNo") ?? undefined,
    policyStatus:
      (searchParams.get("policyStatus") as "enabled" | "disabled" | null) ??
      undefined,
  });

  return NextResponse.json({
    items,
    total: items.length,
  });
}
