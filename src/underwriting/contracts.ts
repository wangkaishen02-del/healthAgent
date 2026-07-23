import type { CalculationParameterScope, PolicyStatus } from "./types.ts";

export type SaveCalculationParameterInput = {
  scope: CalculationParameterScope;
  targetId: string;
  definitionCode: string;
  parameterValue: string;
  description?: string;
  enabled: boolean;
};

export interface ListPoliciesQuery {
  policyNo?: string;
  applicantName?: string;
  policyStatus?: PolicyStatus;
  insuredName?: string;
  insuredIdNo?: string;
  page?: number;
  pageSize?: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface ListPolicyInsuredsQuery extends PageQuery {
  coveragePlanId?: string;
  insuredName?: string;
  insuredIdNo?: string;
}

export interface QueryUnderwritingInput {
  policyNo?: string;
  insuredName?: string;
  insuredIdNo?: string;
}
