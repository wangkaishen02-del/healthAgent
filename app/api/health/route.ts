import { NextResponse } from "next/server";
import { prisma } from "../../../src/db/prisma";

export async function GET() {
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({
    status: "ok",
    service: "underwriting-query-api",
    database: "postgresql",
    date: new Date().toISOString(),
  });
}
