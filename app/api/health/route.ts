import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "underwriting-query-api",
    date: new Date().toISOString(),
  });
}
