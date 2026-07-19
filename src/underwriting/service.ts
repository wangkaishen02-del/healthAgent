import {
  calculationParameterDefinitions,
  calculationParameters,
  coveragePlans,
  insuredPersons,
  policies,
  policyBenefits,
  policyInsureds,
  policyProducts,
} from "./mock-data.ts";
import type {
  CalculationConfigCatalog,
  CalculationParameter,
  CalculationParameterScope,
  PageResult,
  PolicyDetailView,
  PolicyFullView,
  PolicyInsuredView,
  PolicyListItem,
  PolicyProductView,
  PolicyStatus,
} from "./types.ts";

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

function getPolicyCoveragePlans(policyId: string) {
  return coveragePlans
    .filter((item) => item.policyId === policyId)
    .sort((a, b) => a.planCode.localeCompare(b.planCode));
}

function getPolicyInsureds(policyId: string, query: Pick<ListPolicyInsuredsQuery, "coveragePlanId" | "insuredName" | "insuredIdNo"> = {}): PolicyInsuredView[] {
  return policyInsureds
    .filter((item) => item.policyId === policyId && (!query.coveragePlanId || item.coveragePlanId === query.coveragePlanId))
    .map((policyInsured) => ({
      ...policyInsured,
      insuredPerson: insuredPersons.find((person) => person.id === policyInsured.insuredPersonId)!,
      coveragePlan: coveragePlans.find((plan) => plan.id === policyInsured.coveragePlanId),
    }))
    .filter((item) => !query.insuredName || item.insuredPerson.name.includes(query.insuredName))
    .filter((item) => !query.insuredIdNo || (item.insuredPerson.idNo ?? "").includes(query.insuredIdNo));
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
    coveragePlans: getPolicyCoveragePlans(policyId),
    products: getPolicyProducts(policyId),
    insuredCount: policy.insuredCount ?? policyInsureds.filter((item) => item.policyId === policyId).length,
  };
}

export function listPolicyInsureds(policyId: string, query: ListPolicyInsuredsQuery = {}) {
  const policy = policies.find((item) => item.id === policyId);
  if (!policy) return null;

  return {
    policyId: policy.id,
    policyNo: policy.policyNo,
    ...toPageResult(getPolicyInsureds(policyId, query), query),
  };
}

export function queryUnderwriting(input: QueryUnderwritingInput) {
  const policyNo = input.policyNo?.trim();
  const insuredName = input.insuredName?.trim();
  const insuredIdNo = input.insuredIdNo?.trim().toUpperCase();
  if (!policyNo && !insuredName && !insuredIdNo) return { total: 0, matches: [], reason: "query_condition_required" };

  const matches = policies
    .filter((policy) => !policyNo || policy.policyNo === policyNo)
    .flatMap((policy) => getPolicyInsureds(policy.id, { insuredName, insuredIdNo }).map((item) => ({
      policy: {
        id: policy.id,
        policyNo: policy.policyNo,
        policyName: policy.policyName,
        applicantName: policy.applicantName,
        policyStatus: policy.policyStatus,
        effectiveDate: policy.effectiveDate,
        expiryDate: policy.expiryDate,
      },
      policyInsured: {
        id: item.id,
        effectiveDate: item.effectiveDate,
        expiryDate: item.expiryDate,
        coveragePlanId: item.coveragePlanId,
      },
      insuredPerson: {
        id: item.insuredPerson.id,
        insuredNo: item.insuredPerson.insuredNo,
        name: item.insuredPerson.name,
        gender: item.insuredPerson.gender,
        birthDate: item.insuredPerson.birthDate,
        idType: item.insuredPerson.idType,
        idNo: item.insuredPerson.idNo,
        phone: item.insuredPerson.phone,
      },
      coveragePlan: item.coveragePlan ? {
        id: item.coveragePlan.id,
        planCode: item.coveragePlan.planCode,
        planName: item.coveragePlan.planName,
      } : undefined,
    })));

  return { total: matches.length, matches: matches.slice(0, 10), truncated: matches.length > 10 };
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

export function getCalculationConfigCatalog(): CalculationConfigCatalog {
  return {
    policy: policies.map((policy) => ({
      id: policy.id,
      code: policy.policyNo,
      name: policy.policyName ?? policy.applicantName,
      parentLabel: policy.applicantName,
      policyId: policy.id,
    })),
    plan: coveragePlans.map((plan) => ({
      id: plan.id,
      code: plan.planCode,
      name: plan.planName,
      parentLabel: policies.find((policy) => policy.id === plan.policyId)?.policyNo,
      policyId: plan.policyId,
      planId: plan.id,
    })),
    product: policyProducts.map((product) => {
      const plan = coveragePlans.find((item) => item.id === product.coveragePlanId);
      return {
        id: product.id,
        code: product.productCode,
        name: product.productName,
        parentLabel: plan?.planName,
        policyId: product.policyId,
        planId: plan?.id,
        productId: product.id,
      };
    }),
    benefit: policyBenefits.map((benefit) => {
      const product = policyProducts.find((item) => item.id === benefit.policyProductId)!;
      const plan = coveragePlans.find((item) => item.id === product.coveragePlanId);
      return {
        id: benefit.id,
        code: benefit.benefitCode,
        name: benefit.benefitName,
        parentLabel: product.productName,
        policyId: product.policyId,
        planId: plan?.id,
        productId: product.id,
      };
    }),
  };
}

export function getCalculationConfigPolicies() {
  return policies;
}

export function getCalculationParameterDefinitions() {
  return calculationParameterDefinitions;
}

function resolveParameterDefinition(scope: CalculationParameterScope, definitionCode: string) {
  return calculationParameterDefinitions.find((definition) =>
    definition.parameterCode === definitionCode
    && definition.applicableScopes.includes(scope),
  );
}

function calculationTargetExists(scope: CalculationParameterScope, targetId: string) {
  const catalog = getCalculationConfigCatalog();
  return catalog[scope].some((target) => target.id === targetId);
}

export function listCalculationParameters(scope?: CalculationParameterScope, targetId?: string) {
  return calculationParameters
    .filter((item) => (!scope || item.scope === scope) && (!targetId || item.targetId === targetId))
    .sort((a, b) => a.parameterCode.localeCompare(b.parameterCode));
}

export function createCalculationParameter(input: SaveCalculationParameterInput) {
  if (!calculationTargetExists(input.scope, input.targetId)) throw new Error("calculation_target_not_found");
  const definition = resolveParameterDefinition(input.scope, input.definitionCode);
  if (!definition) throw new Error("parameter_definition_not_found");
  const duplicate = calculationParameters.some((item) =>
    item.scope === input.scope
    && item.targetId === input.targetId
    && item.parameterCode === definition.parameterCode,
  );
  if (duplicate) throw new Error("parameter_code_exists");

  const item: CalculationParameter = {
    id: `calc-param-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    targetId: input.targetId,
    parameterCode: definition.parameterCode,
    parameterName: definition.parameterName,
    valueType: definition.valueType,
    parameterValue: input.parameterValue.trim(),
    unit: definition.unit,
    description: input.description?.trim() || undefined,
    enabled: input.enabled,
    updatedAt: new Date().toISOString(),
  };
  calculationParameters.push(item);
  return item;
}

export function updateCalculationParameter(id: string, input: SaveCalculationParameterInput) {
  const index = calculationParameters.findIndex((item) => item.id === id);
  if (index < 0) return null;
  if (!calculationTargetExists(input.scope, input.targetId)) throw new Error("calculation_target_not_found");
  const definition = resolveParameterDefinition(input.scope, input.definitionCode);
  if (!definition) throw new Error("parameter_definition_not_found");
  const duplicate = calculationParameters.some((item) =>
    item.id !== id
    && item.scope === input.scope
    && item.targetId === input.targetId
    && item.parameterCode === definition.parameterCode,
  );
  if (duplicate) throw new Error("parameter_code_exists");

  calculationParameters[index] = {
    id,
    scope: input.scope,
    targetId: input.targetId,
    parameterCode: definition.parameterCode,
    parameterName: definition.parameterName,
    valueType: definition.valueType,
    parameterValue: input.parameterValue.trim(),
    unit: definition.unit,
    description: input.description?.trim() || undefined,
    enabled: input.enabled,
    updatedAt: new Date().toISOString(),
  };
  return calculationParameters[index];
}

export function deleteCalculationParameter(id: string) {
  const index = calculationParameters.findIndex((item) => item.id === id);
  if (index < 0) return false;
  calculationParameters.splice(index, 1);
  return true;
}
