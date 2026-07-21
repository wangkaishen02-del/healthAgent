import { NextResponse } from "next/server";
import { getPolicyDetailViewDb } from "../../../../../src/underwriting/prisma-service";

export async function GET(
  _: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await context.params;
  const detailView = await getPolicyDetailViewDb(policyId);

  if (!detailView) {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }

  return NextResponse.json(detailView);
}
