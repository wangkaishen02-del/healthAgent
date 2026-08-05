import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, Inject, InternalServerErrorException, NotFoundException, Post, Put, Query } from "@nestjs/common";
import type { SaveCalculationParameterInput } from "../../../../src/underwriting/contracts.ts";
import type { FormulaStep, CalculationVariableCategory, AutomationValueType } from "../../../../src/calculation/automation-types.ts";
import type { FormulaValue } from "../../../../src/calculation/expression-engine.ts";
import type { CalculationParameterScope } from "../../../../src/underwriting/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { UnderwritingService } from "../underwriting/underwriting.service.ts";
import { CalculationService } from "./calculation.service.ts";
import { Roles } from "../auth/auth.decorators.ts";
import { CurrentUser } from "../auth/auth.decorators.ts";
import type { AuthenticatedUser } from "../auth/auth.types.ts";

const scopes: CalculationParameterScope[] = ["policy", "plan", "product", "benefit"];

function parseInput(value: unknown): SaveCalculationParameterInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!scopes.includes(body.scope as CalculationParameterScope)
    || typeof body.targetId !== "string"
    || typeof body.definitionCode !== "string"
    || !body.definitionCode.trim()
    || typeof body.parameterValue !== "string"
    || !body.parameterValue.trim()) return null;
  return {
    scope: body.scope as CalculationParameterScope,
    targetId: body.targetId,
    definitionCode: body.definitionCode,
    parameterValue: body.parameterValue,
    description: typeof body.description === "string" ? body.description : undefined,
    enabled: body.enabled !== false,
  };
}

function throwMutationError(error: unknown): never {
  if (error instanceof ConflictException) throw error;
  const message = error instanceof Error ? error.message : "save_failed";
  if (message === "parameter_code_exists") throw new ConflictException(message);
  if (message === "calculation_target_not_found") throw new NotFoundException(message);
  if (message === "parameter_definition_not_found" || message === "parameter_definition_not_applicable") throw new BadRequestException(message);
  throw new InternalServerErrorException(message);
}

@Controller("calculation-parameters")
@Roles("claim_admin")
export class CalculationController {
  constructor(
    @Inject(CalculationService) private readonly calculation: CalculationService,
    @Inject(UnderwritingService) private readonly underwriting: UnderwritingService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const scope = scopes.includes(query.scope as CalculationParameterScope) ? query.scope as CalculationParameterScope : undefined;
    const [configData, definitions, items] = await Promise.all([
      this.underwriting.getCalculationConfigData(),
      this.calculation.definitions(),
      this.calculation.list(scope, query.targetId),
    ]);
    return { catalog: configData.catalog, policies: configData.policies, definitions, items };
  }

  @Post()
  async create(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    const input = parseInput(body);
    if (!input) throw new BadRequestException("invalid_parameter");
    try {
      return await this.idempotency.execute(
        "calculation_parameter:create",
        operationKey,
        input,
        () => this.calculation.create(input),
      );
    } catch (error) { throwMutationError(error); }
  }

  @Put()
  async update(@Body() body: unknown, @Headers("idempotency-key") operationKey?: string) {
    const input = parseInput(body);
    if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string" || !input) {
      throw new BadRequestException("invalid_parameter");
    }
    try {
      const id = (body as { id: string }).id;
      const result = await this.idempotency.execute(
        "calculation_parameter:update",
        operationKey,
        { id, ...input },
        () => this.calculation.update(id, input),
      );
      if (!result) throw new NotFoundException("parameter_not_found");
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throwMutationError(error);
    }
  }

  @Delete()
  async remove(@Query("id") id?: string, @Headers("idempotency-key") operationKey?: string) {
    if (!id) throw new BadRequestException("id is required");
    return this.idempotency.execute(
      "calculation_parameter:delete",
      operationKey,
      { id },
      async () => {
        if (!await this.calculation.delete(id)) throw new NotFoundException("parameter_not_found");
        return { success: true };
      },
    );
  }
}

const variableCategories: CalculationVariableCategory[] = ["bill", "event", "ledger", "benefit", "custom"];
const automationValueTypes: AutomationValueType[] = ["number", "boolean"];

@Controller("automatic-calculation")
@Roles("claim_calculator", "claim_reviewer")
export class AutomaticCalculationController {
  constructor(@Inject(CalculationService) private readonly calculation: CalculationService) {}

  @Get()
  configuration(@Query("policyId") policyId?: string, @Query("claimCaseId") claimCaseId?: string) {
    if (!policyId) throw new BadRequestException("policyId is required");
    return this.calculation.automationConfiguration(policyId, claimCaseId);
  }

  @Get("ledgers")
  ledgers(@Query("policyId") policyId?: string, @Query("insuredPersonId") insuredPersonId?: string) {
    if (!policyId || !insuredPersonId) throw new BadRequestException("policyId and insuredPersonId are required");
    return this.calculation.insuredPolicyLedgers(policyId, insuredPersonId)
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "insured_ledger_load_failed"); });
  }

  @Post("variables")
  saveVariable(@Body() body: Record<string, unknown>) {
    if (typeof body.policyId !== "string"
      || !variableCategories.includes(body.category as CalculationVariableCategory)
      || typeof body.variableName !== "string"
      || !body.variableName.trim()
      || !automationValueTypes.includes(body.valueType as AutomationValueType)) {
      throw new BadRequestException("invalid_variable");
    }
    return this.calculation.saveAutomationVariable({
      id: typeof body.id === "number" ? body.id : undefined,
      policyId: body.policyId,
      category: body.category as CalculationVariableCategory,
      variableName: body.variableName,
      valueType: body.valueType as AutomationValueType,
      timeRange: ["year", "month", "day"].includes(body.timeRange as string) ? body.timeRange as "year" | "month" | "day" : undefined,
      responsibilityRange: ["benefit", "product", "plan", "event"].includes(body.responsibilityRange as string) ? body.responsibilityRange as "benefit" | "product" | "plan" | "event" : undefined,
      defaultValue: typeof body.defaultValue === "string" ? body.defaultValue : undefined,
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "variable_save_failed"); });
  }

  @Post("formulas")
  saveFormula(@Body() body: Record<string, unknown>) {
    if (typeof body.policyId !== "string"
      || typeof body.benefitId !== "string"
      || typeof body.matchExpression !== "string"
      || !Array.isArray(body.steps)) throw new BadRequestException("invalid_formula");
    return this.calculation.saveBenefitFormula({
      policyId: body.policyId,
      benefitId: body.benefitId,
      matchExpression: body.matchExpression,
      steps: body.steps as FormulaStep[],
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "formula_save_failed"); });
  }

  @Post("formulas/validate")
  validateFormula(@Body() body: Record<string, unknown>) {
    if (typeof body.matchExpression !== "string"
      || !Array.isArray(body.steps)
      || !body.variables
      || typeof body.variables !== "object"
      || Array.isArray(body.variables)) throw new BadRequestException("invalid_formula_validation");
    const variables = Object.fromEntries(
      Object.entries(body.variables as Record<string, unknown>)
        .filter((entry): entry is [string, FormulaValue] => ["string", "number", "boolean"].includes(typeof entry[1])),
    );
    try {
      return this.calculation.validateBenefitFormula({
        matchExpression: body.matchExpression,
        steps: body.steps as FormulaStep[],
        variables,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "formula_validation_failed");
    }
  }

  @Post("formulas/standards")
  createStandardFormula(@Body() body: Record<string, unknown>) {
    if (typeof body.policyId !== "string" || typeof body.benefitId !== "string") {
      throw new BadRequestException("invalid_standard_formula");
    }
    return this.calculation.createStandardFormula(body.policyId, body.benefitId)
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "standard_formula_save_failed"); });
  }

  @Post("formulas/reference")
  referenceStandardFormula(@Body() body: Record<string, unknown>) {
    if (typeof body.policyId !== "string"
      || typeof body.benefitId !== "string"
      || typeof body.standardFormulaId !== "number") {
      throw new BadRequestException("invalid_formula_reference");
    }
    return this.calculation.referenceStandardFormula({
      policyId: body.policyId,
      benefitId: body.benefitId,
      standardFormulaId: body.standardFormulaId,
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "formula_reference_failed"); });
  }

  @Post("formulas/unlink")
  unlinkStandardFormula(@Body() body: Record<string, unknown>) {
    if (typeof body.policyId !== "string" || typeof body.benefitId !== "string") {
      throw new BadRequestException("invalid_formula_unlink");
    }
    return this.calculation.unlinkStandardFormula(body.policyId, body.benefitId)
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "formula_unlink_failed"); });
  }

  @Delete("formulas")
  async removeFormula(@Query("policyId") policyId?: string, @Query("benefitId") benefitId?: string) {
    if (!policyId || !benefitId) throw new BadRequestException("policyId and benefitId are required");
    await this.calculation.deleteBenefitFormula(policyId, benefitId)
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "formula_delete_failed"); });
    return { success: true };
  }

  @Post("bills")
  saveBill(@Body() body: Record<string, unknown>) {
    if (typeof body.claimCaseId !== "string"
      || !body.billData || typeof body.billData !== "object" || Array.isArray(body.billData)
      || !body.customValues || typeof body.customValues !== "object" || Array.isArray(body.customValues)
      || !Array.isArray(body.selectedBenefitIds)) throw new BadRequestException("invalid_claim_bill");
    return this.calculation.saveClaimBill({
      id: typeof body.id === "string" ? body.id : undefined,
      claimCaseId: body.claimCaseId,
      billData: body.billData as Record<string, unknown>,
      customValues: body.customValues as Record<string, unknown>,
      selectedBenefitIds: body.selectedBenefitIds.filter((item): item is string => typeof item === "string"),
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "bill_save_failed"); });
  }

  @Delete("bills")
  async removeBill(@Query("id") id?: string) {
    if (!id) throw new BadRequestException("id is required");
    if (!await this.calculation.deleteClaimBill(id)) throw new NotFoundException("claim_bill_not_found");
    return { success: true };
  }

  @Post("events")
  saveEvent(@Body() body: Record<string, unknown>) {
    if (typeof body.claimCaseId !== "string"
      || typeof body.eventType !== "string"
      || typeof body.occurredDate !== "string"
      || typeof body.description !== "string") throw new BadRequestException("invalid_claim_event_entry");
    return this.calculation.saveClaimEventEntry({
      id: typeof body.id === "string" ? body.id : undefined,
      claimCaseId: body.claimCaseId,
      eventType: body.eventType,
      occurredDate: body.occurredDate,
      location: typeof body.location === "string" ? body.location : undefined,
      description: body.description,
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "event_save_failed"); });
  }

  @Delete("events")
  async removeEvent(@Query("id") id?: string) {
    if (!id) throw new BadRequestException("id is required");
    if (!await this.calculation.deleteClaimEventEntry(id)) throw new NotFoundException("claim_event_entry_not_found");
    return { success: true };
  }

  @Post("diseases")
  saveDisease(@Body() body: Record<string, unknown>) {
    if (typeof body.claimCaseId !== "string"
      || typeof body.diseaseName !== "string"
      || typeof body.diagnosisDate !== "string"
      || typeof body.hospital !== "string") throw new BadRequestException("invalid_claim_disease_entry");
    return this.calculation.saveClaimDiseaseEntry({
      id: typeof body.id === "string" ? body.id : undefined,
      claimCaseId: body.claimCaseId,
      diseaseName: body.diseaseName,
      icdCode: typeof body.icdCode === "string" ? body.icdCode : undefined,
      diagnosisDate: body.diagnosisDate,
      hospital: body.hospital,
      note: typeof body.note === "string" ? body.note : undefined,
    }).catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "disease_save_failed"); });
  }

  @Delete("diseases")
  async removeDisease(@Query("id") id?: string) {
    if (!id) throw new BadRequestException("id is required");
    if (!await this.calculation.deleteClaimDiseaseEntry(id)) throw new NotFoundException("claim_disease_entry_not_found");
    return { success: true };
  }

  @Post("run")
  run(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    if (typeof body.claimCaseId !== "string") throw new BadRequestException("claimCaseId is required");
    return this.calculation.runAutomaticCalculation(body.claimCaseId, { userId: user.id, userName: user.displayName })
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "automatic_calculation_failed"); });
  }

  @Post("rollback")
  rollback(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    if (typeof body.claimCaseId !== "string") throw new BadRequestException("claimCaseId is required");
    return this.calculation.rollbackAutomaticCalculation(body.claimCaseId, { userId: user.id, userName: user.displayName })
      .catch((error: unknown) => { throw new BadRequestException(error instanceof Error ? error.message : "calculation_rollback_failed"); });
  }
}
