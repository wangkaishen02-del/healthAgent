import {
  insuredPersons,
  policies,
  policyBenefits,
  policyInsureds,
  policyProducts,
} from "./mock-data.ts";
import type {
  PageResult,
  PolicyDetailView,
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
  page?: number;
  pageSize?: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

function resolvePage(query: PageQuery = {}) {
  const page = Number.isInteger(query.page) && query.page! > 0 ? query.page! : 1;
  const pageSize = Number.isInteger(query.pageSize) && query.pageSize! > 0
    ? Math.min(query.pageSize!, 100)
    : 10;
  return { page, pageSize };
}

function toPageResult<T>(items: T[], query: PageQuery = {}): PageResult<T> {
  const { page, pageSize } = resolvePage(query);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page: currentPage,
    pageSize,
    totalPages,
  };
}

function getPolicyProducts(policyId: string): PolicyProductView[] {
  return policyProducts
    .filter((item) => item.policyId === policyId)
    .sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0))
    .map((product) => ({
      ...product,
      benefits: policyBenefits
        .filter((benefit) => benefit.policyProductId === product.id)
        .sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0)),
    }));
}

function getPolicyInsureds(policyId: string): PolicyInsuredView[] {
  return policyInsureds
    .filter((item) => item.policyId === policyId)
    .map((policyInsured) => ({
      ...policyInsured,
      insuredPerson: insuredPersons.find((person) => person.id === policyInsured.insuredPersonId)!,
    }));
}

export function listPolicies(query: ListPoliciesQuery = {}): PageResult<PolicyListItem> {
  const items = policies
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

  return toPageResult(items, query);
}

export function getPolicyDetailView(policyId: string): PolicyDetailView | null {
  const policy = policies.find((item) => item.id === policyId);
  if (!policy) return null;

  return {
    policy,
    products: getPolicyProducts(policyId),
    insuredCount: policy.insuredCount ?? policyInsureds.filter((item) => item.policyId === policyId).length,
  };
}

export function listPolicyInsureds(policyId: string, query: PageQuery = {}) {
  const policy = policies.find((item) => item.id === policyId);
  if (!policy) return null;

  return {
    policyId: policy.id,
    policyNo: policy.policyNo,
    ...toPageResult(getPolicyInsureds(policyId), query),
  };
}

export function getPolicyFullView(policyId: string): PolicyFullView | null {
  const detail = getPolicyDetailView(policyId);
  if (!detail) return null;

  return {
    policy: detail.policy,
    products: detail.products,
    insureds: getPolicyInsureds(policyId),
  };
}
