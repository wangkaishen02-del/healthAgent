import { NextRequest, NextResponse } from "next/server";
import {
  createCalculationParameter,
  deleteCalculationParameter,
  getCalculationConfigCatalog,
  getCalculationConfigPolicies,
  getCalculationParameterDefinitions,
  listCalculationParameters,
  updateCalculationParameter,
  type SaveCalculationParameterInput,
} from "../../../src/underwriting/service";
import type { CalculationParameterScope } from "../../../src/underwriting/types";

const scopes: CalculationParameterScope[] = ["policy", "plan", "product", "benefit"];
function parseInput(value: unknown): SaveCalculationParameterInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    !scopes.includes(body.scope as CalculationParameterScope)
    || typeof body.targetId !== "string"
    || typeof body.definitionCode !== "string"
    || !body.definitionCode.trim()
    || typeof body.parameterValue !== "string"
    || !body.parameterValue.trim()
  ) return null;

  return {
    scope: body.scope as CalculationParameterScope,
    targetId: body.targetId,
    definitionCode: body.definitionCode,
    parameterValue: body.parameterValue,
    description: typeof body.description === "string" ? body.description : undefined,
    enabled: body.enabled !== false,
  };
}

function mutationError(error: unknown) {
  const message = error instanceof Error ? error.message : "save_failed";
  const status = message === "parameter_code_exists"
    ? 409
    : message === "calculation_target_not_found"
      ? 404
      : message === "parameter_definition_not_found"
        ? 400
        : 500;
  return NextResponse.json({ message }, { status });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawScope = searchParams.get("scope");
  const scope = scopes.includes(rawScope as CalculationParameterScope)
    ? rawScope as CalculationParameterScope
    : undefined;
  const targetId = searchParams.get("targetId") ?? undefined;
  return NextResponse.json({
    catalog: getCalculationConfigCatalog(),
    policies: getCalculationConfigPolicies(),
    definitions: getCalculationParameterDefinitions(),
    items: listCalculationParameters(scope, targetId),
  });
}

export async function POST(request: NextRequest) {
  const input = parseInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ message: "invalid_parameter" }, { status: 400 });
  try {
    return NextResponse.json(createCalculationParameter(input), { status: 201 });
  } catch (error) {
    return mutationError(error);
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as ({ id?: unknown } & Record<string, unknown>) | null;
  const input = parseInput(body);
  if (!body || typeof body.id !== "string" || !input) {
    return NextResponse.json({ message: "invalid_parameter" }, { status: 400 });
  }
  try {
    const item = updateCalculationParameter(body.id, input);
    return item
      ? NextResponse.json(item)
      : NextResponse.json({ message: "parameter_not_found" }, { status: 404 });
  } catch (error) {
    return mutationError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 });
  return deleteCalculationParameter(id)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ message: "parameter_not_found" }, { status: 404 });
}
