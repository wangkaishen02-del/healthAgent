import { Injectable } from "@nestjs/common";
import {
  createCalculationParameterDb,
  deleteCalculationParameterDb,
  getCalculationParameterDefinitionsDb,
  listCalculationParametersDb,
  updateCalculationParameterDb,
} from "../../../../src/underwriting/prisma-calculation-service.ts";
import type { SaveCalculationParameterInput } from "../../../../src/underwriting/contracts.ts";
import type { CalculationParameterScope } from "../../../../src/underwriting/types.ts";

@Injectable()
export class CalculationService {
  definitions() { return getCalculationParameterDefinitionsDb(); }
  list(scope?: CalculationParameterScope, targetId?: string) { return listCalculationParametersDb(scope, targetId); }
  create(input: SaveCalculationParameterInput) { return createCalculationParameterDb(input); }
  update(id: string, input: SaveCalculationParameterInput) { return updateCalculationParameterDb(id, input); }
  delete(id: string) { return deleteCalculationParameterDb(id); }
}
