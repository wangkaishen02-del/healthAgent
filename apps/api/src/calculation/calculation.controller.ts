import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, Inject, InternalServerErrorException, NotFoundException, Post, Put, Query } from "@nestjs/common";
import type { SaveCalculationParameterInput } from "../../../../src/underwriting/contracts.ts";
import type { CalculationParameterScope } from "../../../../src/underwriting/types.ts";
import { IdempotencyService } from "../idempotency/idempotency.service.ts";
import { UnderwritingService } from "../underwriting/underwriting.service.ts";
import { CalculationService } from "./calculation.service.ts";

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
