import { NextResponse } from "next/server";
import { getPolicyFullView } from "../../../../../src/underwriting/service";

export async function GET(
  _: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await context.params;
  const fullView = getPolicyFullView(policyId);

  if (!fullView) {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }

  return NextResponse.json(fullView);
}
