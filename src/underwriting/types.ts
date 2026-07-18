export type PolicyStatus = "enabled" | "disabled";
export type ProductStatus = "active" | "inactive";
export type BenefitStatus = "active" | "inactive";
export type Gender = "male" | "female" | "unknown";
export type InsuredRole = "employee" | "spouse" | "child" | "parent" | "other";

export interface Policy {
  id: string;
  policyNo: string;
  policyName?: string;
  applicantName: string;
  holderType: "group" | "company";
  policyStatus: PolicyStatus;
  effectiveDate: string;
  expiryDate: string;
  currency: string;
  totalPremium?: number;
  insuredCount?: number;
  issueDate?: string;
  underwritingDate?: string;
  remark?: string;
}

export interface PolicyProduct {
  id: string;
  policyId: string;
  coveragePlanId: string;
  productNo: string;
  productCode: string;
  productName: string;
  productStatus: ProductStatus;
  effectiveDate: string;
  expiryDate: string;
  premium?: number;
  sumInsured?: number;
  sequenceNo?: number;
  remark?: string;
}

export interface CoveragePlan {
  id: string;
  policyId: string;
  planCode: string;
  planName: string;
  effectiveDate: string;
  expiryDate: string;
  status: "active" | "inactive";
  remark?: string;
}

export type CalculationParameterScope = "policy" | "plan" | "product" | "benefit";
export type CalculationParameterValueType = "text" | "number" | "percentage" | "amount" | "boolean";

export interface CalculationParameterDefinition {
  parameterCode: string;
  parameterName: string;
  valueType: CalculationParameterValueType;
  unit?: string;
  applicableScopes: CalculationParameterScope[];
  description?: string;
}

export interface CalculationParameter {
  id: string;
  scope: CalculationParameterScope;
  targetId: string;
  parameterCode: string;
  parameterName: string;
  valueType: CalculationParameterValueType;
  parameterValue: string;
  unit?: string;
  description?: string;
  enabled: boolean;
  updatedAt: string;
}

export interface CalculationConfigTarget {
  id: string;
  code: string;
  name: string;
  parentLabel?: string;
  policyId: string;
  planId?: string;
  productId?: string;
}

export type CalculationConfigCatalog = Record<CalculationParameterScope, CalculationConfigTarget[]>;

export interface PolicyBenefit {
  id: string;
  policyProductId: string;
  benefitNo: string;
  benefitCode: string;
  benefitName: string;
  benefitStatus: BenefitStatus;
  effectiveDate: string;
  expiryDate: string;
  sequenceNo?: number;
  claimableFlag: boolean;
  remark?: string;
}

export interface InsuredPerson {
  id: string;
  insuredNo: string;
  name: string;
  gender?: Gender;
  birthDate?: string;
  idType?: "id_card" | "passport" | "other";
  idNo?: string;
  phone?: string;
}

export interface PolicyInsured {
  id: string;
  policyId: string;
  insuredPersonId: string;
  effectiveDate: string;
  expiryDate: string;
  joinDate?: string;
  leaveDate?: string;
  insuredRole?: InsuredRole;
  remark?: string;
}

export interface PolicyListItem {
  id: string;
  policyNo: string;
  policyName?: string;
  applicantName: string;
  policyStatus: PolicyStatus;
  effectiveDate: string;
  expiryDate: string;
  insuredCount: number;
}

export interface PolicyProductView extends PolicyProduct {
  benefits: PolicyBenefit[];
}

export interface PolicyInsuredView extends PolicyInsured {
  insuredPerson: InsuredPerson;
}

export interface PolicyFullView {
  policy: Policy;
  products: PolicyProductView[];
  insureds: PolicyInsuredView[];
}

export interface PolicyDetailView {
  policy: Policy;
  products: PolicyProductView[];
  insuredCount: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
