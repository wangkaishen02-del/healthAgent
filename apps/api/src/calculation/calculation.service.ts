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
import {
  deleteBenefitFormula,
  deleteClaimBill,
  getAutomationConfiguration,
  runAutomaticCalculation,
  saveAutomationVariable,
  saveBenefitFormula,
  saveClaimBill,
} from "../../../../src/calculation/automation-service.ts";

@Injectable()
export class CalculationService {
  definitions() { return getCalculationParameterDefinitionsDb(); }
  list(scope?: CalculationParameterScope, targetId?: string) { return listCalculationParametersDb(scope, targetId); }
  create(input: SaveCalculationParameterInput) { return createCalculationParameterDb(input); }
  update(id: string, input: SaveCalculationParameterInput) { return updateCalculationParameterDb(id, input); }
  delete(id: string) { return deleteCalculationParameterDb(id); }
  automationConfiguration(policyId: string, claimCaseId?: string) { return getAutomationConfiguration(policyId, claimCaseId); }
  saveAutomationVariable(input: Parameters<typeof saveAutomationVariable>[0]) { return saveAutomationVariable(input); }
  saveBenefitFormula(input: Parameters<typeof saveBenefitFormula>[0]) { return saveBenefitFormula(input); }
  deleteBenefitFormula(policyId: string, benefitId: string) { return deleteBenefitFormula(policyId, benefitId); }
  saveClaimBill(input: Parameters<typeof saveClaimBill>[0]) { return saveClaimBill(input); }
  deleteClaimBill(id: string) { return deleteClaimBill(id); }
  runAutomaticCalculation(claimCaseId: string, commit: boolean) { return runAutomaticCalculation(claimCaseId, commit); }
}
