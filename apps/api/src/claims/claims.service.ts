import { Injectable } from "@nestjs/common";
import {
  createClaimCaseDb,
  createClaimCaseRemarkDb,
  createClaimEventDb,
  getClaimCaseStatusDb,
  listClaimCasesDb,
  listClaimEventsDb,
  queryClaimCasesDb,
  transitionClaimCaseDb,
  updateClaimCaseDb,
  updateClaimEventDb,
} from "../../../../src/claims/prisma-service.ts";
import { rollbackAutomaticCalculation } from "../../../../src/calculation/automation-service.ts";
import type { ClaimDirectWorkflowAction } from "../../../../src/claims/state-machine.ts";
import type { ClaimEventInput, ClaimOperator, ClaimRemarkStage, CreateClaimCaseInput } from "../../../../src/claims/types.ts";

@Injectable()
export class ClaimsService {
  listCases() { return listClaimCasesDb(); }
  getCaseStatus(id: string) { return getClaimCaseStatusDb(id); }
  queryCases(input: Parameters<typeof queryClaimCasesDb>[0]) { return queryClaimCasesDb(input); }
  createCase(input: CreateClaimCaseInput, operator: ClaimOperator) { return createClaimCaseDb(input, operator); }
  createRemark(claimCaseId: string, stage: ClaimRemarkStage, content: string) { return createClaimCaseRemarkDb(claimCaseId, stage, content); }
  updateCase(id: string, input: CreateClaimCaseInput) { return updateClaimCaseDb(id, input); }
  transitionCase(id: string, action: ClaimDirectWorkflowAction, operator: ClaimOperator) { return transitionClaimCaseDb(id, action, operator); }
  async cancelCase(id: string, operator: ClaimOperator) {
    let status = await getClaimCaseStatusDb(id);
    if (status === "reviewing") {
      await transitionClaimCaseDb(id, "rollback", operator);
      status = "calculating";
    }
    if (status === "calculating") {
      await rollbackAutomaticCalculation(id, operator);
      status = "entering";
    }
    if (!status) return null;
    return transitionClaimCaseDb(id, "cancel", operator);
  }
  listEvents(input: Parameters<typeof listClaimEventsDb>[0]) { return listClaimEventsDb(input); }
  createEvent(insuredPersonId: string, input: ClaimEventInput) { return createClaimEventDb(insuredPersonId, input); }
  updateEvent(id: string, insuredPersonId: string, input: ClaimEventInput) { return updateClaimEventDb(id, insuredPersonId, input); }
}
