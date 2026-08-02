import type { CalculationParameter as DbCalculationParameter, CalculationParameterDefinition as DbDefinition } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import type { CalculationParameterScope } from "./types.ts";
import type { SaveCalculationParameterInput } from "./contracts.ts";

function mapDefinition(item: DbDefinition) {
  return { parameterCode: item.parameterCode, parameterName: item.parameterName, valueType: item.valueType, unit: item.unit ?? undefined, applicableScopes: item.applicableScopes as CalculationParameterScope[], description: item.description ?? undefined };
}

function mapParameter(item: DbCalculationParameter & { definition: DbDefinition }) {
  return { id: item.id, scope: item.scope, targetId: item.targetId, parameterCode: item.definition.parameterCode, parameterName: item.definition.parameterName, valueType: item.definition.valueType, parameterValue: item.parameterValue, unit: item.definition.unit ?? undefined, description: item.description ?? undefined, enabled: item.enabled, updatedAt: item.updatedAt.toISOString() };
}

export function isSupportedConfigurationParameterName(name: string) {
  return name === "限额" || name === "免赔额" || name === "赔付比例";
}

async function targetExists(scope: CalculationParameterScope, targetId: string) {
  if (scope === "policy") return Boolean(await prisma.policy.findUnique({ where: { id: targetId }, select: { id: true } }));
  if (scope === "plan") return Boolean(await prisma.coveragePlan.findUnique({ where: { id: targetId }, select: { id: true } }));
  if (scope === "product") return Boolean(await prisma.policyProduct.findUnique({ where: { id: targetId }, select: { id: true } }));
  return Boolean(await prisma.policyBenefit.findUnique({ where: { id: targetId }, select: { id: true } }));
}

async function validateInput(input: SaveCalculationParameterInput, restrictToNewParameterTypes = false) {
  const definition = await prisma.calculationParameterDefinition.findUnique({ where: { parameterCode: input.definitionCode } });
  if (!definition || !definition.enabled || (restrictToNewParameterTypes && !isSupportedConfigurationParameterName(definition.parameterName))) throw new Error("parameter_definition_not_found");
  if (!(definition.applicableScopes as string[]).includes(input.scope)) throw new Error("parameter_definition_not_applicable");
  if (!await targetExists(input.scope, input.targetId)) throw new Error("calculation_target_not_found");
  return definition;
}

export async function getCalculationParameterDefinitionsDb() {
  return (await prisma.calculationParameterDefinition.findMany({ where: { enabled: true }, orderBy: { parameterCode: "asc" } })).map(mapDefinition);
}

export async function listCalculationParametersDb(scope?: CalculationParameterScope, targetId?: string) {
  return (await prisma.calculationParameter.findMany({ where: { scope, targetId }, include: { definition: true }, orderBy: { updatedAt: "desc" } }))
    .map(mapParameter);
}

export async function createCalculationParameterDb(input: SaveCalculationParameterInput) {
  const definition = await validateInput(input, true);
  try {
    return mapParameter(await prisma.calculationParameter.create({ data: { scope: input.scope, targetId: input.targetId, definitionId: definition.id, parameterValue: input.parameterValue.trim(), description: input.description?.trim() || null, enabled: input.enabled }, include: { definition: true } }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new Error("parameter_code_exists");
    throw error;
  }
}

export async function updateCalculationParameterDb(id: string, input: SaveCalculationParameterInput) {
  if (!await prisma.calculationParameter.findUnique({ where: { id } })) return null;
  const definition = await validateInput(input);
  try {
    return mapParameter(await prisma.calculationParameter.update({ where: { id }, data: { scope: input.scope, targetId: input.targetId, definitionId: definition.id, parameterValue: input.parameterValue.trim(), description: input.description?.trim() || null, enabled: input.enabled }, include: { definition: true } }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new Error("parameter_code_exists");
    throw error;
  }
}

export async function deleteCalculationParameterDb(id: string) {
  const result = await prisma.calculationParameter.deleteMany({ where: { id } });
  return result.count > 0;
}
