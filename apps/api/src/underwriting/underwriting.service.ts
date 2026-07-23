import { Injectable } from "@nestjs/common";
import {
  getCalculationConfigDataDb,
  getPolicyDetailViewDb,
  listPoliciesDb,
  listPolicyInsuredsDb,
  queryUnderwritingDb,
} from "../../../../src/underwriting/prisma-service.ts";
import type { ListPoliciesQuery, ListPolicyInsuredsQuery, QueryUnderwritingInput } from "../../../../src/underwriting/contracts.ts";

@Injectable()
export class UnderwritingService {
  listPolicies(query: ListPoliciesQuery) {
    return listPoliciesDb(query);
  }

  getPolicyDetail(policyId: string) {
    return getPolicyDetailViewDb(policyId);
  }

  listPolicyInsureds(policyId: string, query: ListPolicyInsuredsQuery) {
    return listPolicyInsuredsDb(policyId, query);
  }

  queryUnderwriting(input: QueryUnderwritingInput) {
    return queryUnderwritingDb(input);
  }

  getCalculationConfigData() {
    return getCalculationConfigDataDb();
  }
}
