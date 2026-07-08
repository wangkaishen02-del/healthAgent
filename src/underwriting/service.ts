import {
  insuredPersons,
  policies,
  policyBenefits,
  policyInsureds,
  policyProducts,
} from "./mock-data.ts";
import type {
  PolicyFullView,
  PolicyInsuredView,
  PolicyListItem,
  PolicyProductView,
  PolicyStatus,
} from "./types.ts";

export interface ListPoliciesQuery {
  policyNo?: string;
  applicantName?: string;
  policyStatus?: PolicyStatus;
  insuredName?: string;
  insuredIdNo?: string;
}

export function listPolicies(query: ListPoliciesQuery = {}): PolicyListItem[] {
  return policies
    .filter((policy) => {
      if (query.policyNo && !policy.policyNo.includes(query.policyNo)) return false;
      if (query.applicantName && !policy.applicantName.includes(query.applicantName)) return false;
      if (query.policyStatus && policy.policyStatus !== query.policyStatus) return false;
      if (query.insuredName || query.insuredIdNo) {
        const matchedInsureds = policyInsureds
          .filter((item) => item.policyId === policy.id)
          .map((item) => insuredPersons.find((person) => person.id === item.insuredPersonId))
          .filter(Boolean);

        const hasMatchedInsured = matchedInsureds.some((person) => {
          if (!person) return false;
          if (query.insuredName && !person.name.includes(query.insuredName)) return false;
          if (query.insuredIdNo && !(person.idNo ?? "").includes(query.insuredIdNo)) return false;
          return true;
        });

        if (!hasMatchedInsured) return false;
      }
      return true;
    })
    .map((policy) => ({
      id: policy.id,
      policyNo: policy.policyNo,
      policyName: policy.policyName,
      applicantName: policy.applicantName,
      policyStatus: policy.policyStatus,
      effectiveDate: policy.effectiveDate,
      expiryDate: policy.expiryDate,
      insuredCount:
        policy.insuredCount ??
        policyInsureds.filter((item) => item.policyId === policy.id).length,
    }));
}

export function getPolicyFullView(policyId: string): PolicyFullView | null {
  const policy = policies.find((item) => item.id === policyId);
  if (!policy) return null;

  const products: PolicyProductView[] = policyProducts
    .filter((item) => item.policyId === policyId)
    .sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0))
    .map((product) => ({
      ...product,
      benefits: policyBenefits
        .filter((benefit) => benefit.policyProductId === product.id)
        .sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0)),
    }));

  const insureds: PolicyInsuredView[] = policyInsureds
    .filter((item) => item.policyId === policyId)
    .map((policyInsured) => ({
      ...policyInsured,
      insuredPerson: insuredPersons.find((person) => person.id === policyInsured.insuredPersonId)!,
    }));

  return {
    policy,
    products,
    insureds,
  };
}
