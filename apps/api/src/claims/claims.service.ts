import { Injectable } from "@nestjs/common";
import {
  changeClaimCaseStatusDb,
  createClaimCaseDb,
  createClaimCaseRemarkDb,
  createClaimEventDb,
  listClaimCasesDb,
  listClaimEventsDb,
  queryClaimCasesDb,
  rollbackClaimCaseStatusDb,
  updateClaimCaseDb,
  updateClaimEventDb,
} from "../../../../src/claims/prisma-service.ts";
import type { ClaimCaseStatus, ClaimEventInput, ClaimRemarkStage, CreateClaimCaseInput } from "../../../../src/claims/types.ts";

@Injectable()
export class ClaimsService {
  listCases() { return listClaimCasesDb(); }
  queryCases(input: Parameters<typeof queryClaimCasesDb>[0]) { return queryClaimCasesDb(input); }
  createCase(input: CreateClaimCaseInput) { return createClaimCaseDb(input); }
  createRemark(claimCaseId: string, stage: ClaimRemarkStage, content: string) { return createClaimCaseRemarkDb(claimCaseId, stage, content); }
  updateCase(id: string, input: CreateClaimCaseInput) { return updateClaimCaseDb(id, input); }
  changeCaseStatus(id: string, status: ClaimCaseStatus) { return changeClaimCaseStatusDb(id, status); }
  rollbackCase(id: string) { return rollbackClaimCaseStatusDb(id); }
  listEvents(input: Parameters<typeof listClaimEventsDb>[0]) { return listClaimEventsDb(input); }
  createEvent(insuredPersonId: string, input: ClaimEventInput) { return createClaimEventDb(insuredPersonId, input); }
  updateEvent(id: string, insuredPersonId: string, input: ClaimEventInput) { return updateClaimEventDb(id, insuredPersonId, input); }
}
