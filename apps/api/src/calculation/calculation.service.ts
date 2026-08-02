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
  deleteClaimDiseaseEntry,
  deleteClaimEventEntry,
  getAutomationConfiguration,
  listInsuredPolicyLedgers,
  rollbackAutomaticCalculation,
  runAutomaticCalculation,
  saveAutomationVariable,
  saveBenefitFormula,
  saveClaimBill,
  saveClaimDiseaseEntry,
  saveClaimEventEntry,
  validateBenefitFormula,
} from "../../../../src/calculation/automation-service.ts";
import type { ClaimOperator } from "../../../../src/claims/types.ts";

@Injectable()
export class CalculationService {
  definitions() { return getCalculationParameterDefinitionsDb(); }
  list(scope?: CalculationParameterScope, targetId?: string) { return listCalculationParametersDb(scope, targetId); }
  create(input: SaveCalculationParameterInput) { return createCalculationParameterDb(input); }
  update(id: string, input: SaveCalculationParameterInput) { return updateCalculationParameterDb(id, input); }
  delete(id: string) { return deleteCalculationParameterDb(id); }
  automationConfiguration(policyId: string, claimCaseId?: string) { return getAutomationConfiguration(policyId, claimCaseId); }
  insuredPolicyLedgers(policyId: string, insuredPersonId: string) { return listInsuredPolicyLedgers(policyId, insuredPersonId); }
  saveAutomationVariable(input: Parameters<typeof saveAutomationVariable>[0]) { return saveAutomationVariable(input); }
  saveBenefitFormula(input: Parameters<typeof saveBenefitFormula>[0]) { return saveBenefitFormula(input); }
  validateBenefitFormula(input: Parameters<typeof validateBenefitFormula>[0]) { return validateBenefitFormula(input); }
  deleteBenefitFormula(policyId: string, benefitId: string) { return deleteBenefitFormula(policyId, benefitId); }
  saveClaimBill(input: Parameters<typeof saveClaimBill>[0]) { return saveClaimBill(input); }
  deleteClaimBill(id: string) { return deleteClaimBill(id); }
  saveClaimEventEntry(input: Parameters<typeof saveClaimEventEntry>[0]) { return saveClaimEventEntry(input); }
  deleteClaimEventEntry(id: string) { return deleteClaimEventEntry(id); }
  saveClaimDiseaseEntry(input: Parameters<typeof saveClaimDiseaseEntry>[0]) { return saveClaimDiseaseEntry(input); }
  deleteClaimDiseaseEntry(id: string) { return deleteClaimDiseaseEntry(id); }
  runAutomaticCalculation(claimCaseId: string, operator: ClaimOperator) { return runAutomaticCalculation(claimCaseId, operator); }
  rollbackAutomaticCalculation(claimCaseId: string, operator: ClaimOperator) { return rollbackAutomaticCalculation(claimCaseId, operator); }
}
