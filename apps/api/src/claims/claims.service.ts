import { Injectable } from "@nestjs/common";
import {
  changeClaimCaseStatusDb,
  createClaimCaseDb,
  createClaimEventDb,
  listClaimCasesDb,
  listClaimEventsDb,
  queryClaimCasesDb,
  updateClaimCaseDb,
  updateClaimEventDb,
} from "../../../../src/claims/prisma-service.ts";
import type { ClaimCaseStatus, ClaimEventInput, CreateClaimCaseInput } from "../../../../src/claims/types.ts";

@Injectable()
export class ClaimsService {
  listCases() { return listClaimCasesDb(); }
  queryCases(input: Parameters<typeof queryClaimCasesDb>[0]) { return queryClaimCasesDb(input); }
  createCase(input: CreateClaimCaseInput) { return createClaimCaseDb(input); }
  updateCase(id: string, input: CreateClaimCaseInput) { return updateClaimCaseDb(id, input); }
  changeCaseStatus(id: string, status: ClaimCaseStatus) { return changeClaimCaseStatusDb(id, status); }
  listEvents(input: Parameters<typeof listClaimEventsDb>[0]) { return listClaimEventsDb(input); }
  createEvent(insuredPersonId: string, input: ClaimEventInput) { return createClaimEventDb(insuredPersonId, input); }
  updateEvent(id: string, insuredPersonId: string, input: ClaimEventInput) { return updateClaimEventDb(id, insuredPersonId, input); }
}
