import type { CoveragePlan as DbCoveragePlan, InsuredPerson as DbInsuredPerson, Policy as DbPolicy, PolicyBenefit as DbPolicyBenefit, PolicyInsured as DbPolicyInsured, PolicyProduct as DbPolicyProduct } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import type { CalculationConfigCatalog, CoveragePlan, InsuredPerson, PageResult, Policy, PolicyBenefit, PolicyDetailView, PolicyInsuredView, PolicyListItem, PolicyProduct, PolicyProductView, PolicyStatus } from "./types.ts";
import type { ListPoliciesQuery, ListPolicyInsuredsQuery, QueryUnderwritingInput } from "./contracts.ts";

function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function optionalDate(value: Date | null) { return value ? dateOnly(value) : undefined; }
function pageSettings(page?: number, pageSize?: number) { return { page: Number.isInteger(page) && page! > 0 ? page! : 1, pageSize: Number.isInteger(pageSize) && pageSize! > 0 ? Math.min(pageSize!, 100) : 10 }; }

function mapPolicy(item: DbPolicy): Policy {
  return { id: item.id, policyNo: item.policyNo, policyName: item.policyName ?? undefined, applicantName: item.applicantName, holderType: item.holderType, policyStatus: item.policyStatus, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), currency: item.currency, totalPremium: item.totalPremium ? Number(item.totalPremium) : undefined, insuredCount: item.insuredCount ?? undefined, issueDate: optionalDate(item.issueDate), underwritingDate: optionalDate(item.underwritingDate), remark: item.remark ?? undefined };
}
function mapPlan(item: DbCoveragePlan): CoveragePlan { return { id: item.id, policyId: item.policyId, planCode: item.planCode, planName: item.planName, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), status: item.status, remark: item.remark ?? undefined }; }
function mapBenefit(item: DbPolicyBenefit): PolicyBenefit { return { id: item.id, policyProductId: item.policyProductId, benefitNo: item.benefitNo, benefitCode: item.benefitCode, benefitName: item.benefitName, benefitStatus: item.benefitStatus, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), sequenceNo: item.sequenceNo ?? undefined, claimableFlag: item.claimableFlag, remark: item.remark ?? undefined }; }
function mapProduct(item: DbPolicyProduct): PolicyProduct { return { id: item.id, policyId: item.policyId, coveragePlanId: item.coveragePlanId ?? "", productNo: item.productNo, productCode: item.productCode, productName: item.productName, productStatus: item.productStatus, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), premium: item.premium ? Number(item.premium) : undefined, sumInsured: item.sumInsured ? Number(item.sumInsured) : undefined, sequenceNo: item.sequenceNo ?? undefined, remark: item.remark ?? undefined }; }
function mapPerson(item: DbInsuredPerson): InsuredPerson { return { id: item.id, insuredNo: item.insuredNo, name: item.name, gender: item.gender ?? undefined, birthDate: optionalDate(item.birthDate), idType: item.idType ?? undefined, idNo: item.idNo ?? undefined, phone: item.phone ?? undefined }; }
function mapPolicyInsured(item: DbPolicyInsured, person: DbInsuredPerson, plan: DbCoveragePlan | null): PolicyInsuredView { return { id: item.id, policyId: item.policyId, coveragePlanId: item.coveragePlanId ?? undefined, insuredPersonId: item.insuredPersonId, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), joinDate: optionalDate(item.joinDate), leaveDate: optionalDate(item.leaveDate), insuredRole: item.insuredRole ?? undefined, remark: item.remark ?? undefined, insuredPerson: mapPerson(person), coveragePlan: plan ? mapPlan(plan) : undefined }; }

async function matchingPersonIds(insuredName?: string, insuredIdNo?: string) {
  if (!insuredName && !insuredIdNo) return undefined;
  const people = await prisma.insuredPerson.findMany({ where: { name: insuredName ? { contains: insuredName, mode: "insensitive" } : undefined, idNo: insuredIdNo ? { contains: insuredIdNo, mode: "insensitive" } : undefined }, select: { id: true } });
  return people.map((item) => item.id);
}

export async function listPoliciesDb(query: ListPoliciesQuery = {}): Promise<PageResult<PolicyListItem>> {
  const settings = pageSettings(query.page, query.pageSize);
  const personIds = await matchingPersonIds(query.insuredName?.trim(), query.insuredIdNo?.trim());
  const policyIds = personIds ? [...new Set((await prisma.policyInsured.findMany({ where: { insuredPersonId: { in: personIds } }, select: { policyId: true } })).map((item) => item.policyId))] : undefined;
  const where = { id: policyIds ? { in: policyIds } : undefined, policyNo: query.policyNo ? { contains: query.policyNo.trim(), mode: "insensitive" as const } : undefined, applicantName: query.applicantName ? { contains: query.applicantName.trim(), mode: "insensitive" as const } : undefined, policyStatus: query.policyStatus };
  const total = await prisma.policy.count({ where }); const totalPages = Math.max(1, Math.ceil(total / settings.pageSize)); const page = Math.min(settings.page, totalPages);
  const items = await prisma.policy.findMany({ where, orderBy: { policyNo: "asc" }, skip: (page - 1) * settings.pageSize, take: settings.pageSize });
  return { items: items.map((item) => ({ id: item.id, policyNo: item.policyNo, policyName: item.policyName ?? undefined, applicantName: item.applicantName, policyStatus: item.policyStatus, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), insuredCount: item.insuredCount ?? 0 })), total, page, pageSize: settings.pageSize, totalPages };
}

export async function getPolicyDetailViewDb(policyId: string): Promise<PolicyDetailView | null> {
  const policy = await prisma.policy.findUnique({ where: { id: policyId } }); if (!policy) return null;
  const [plans, products, insuredCount] = await Promise.all([prisma.coveragePlan.findMany({ where: { policyId }, orderBy: { planCode: "asc" } }), prisma.policyProduct.findMany({ where: { policyId }, orderBy: { sequenceNo: "asc" }, include: { benefits: { orderBy: { sequenceNo: "asc" } } } }), prisma.policyInsured.count({ where: { policyId } })]);
  return { policy: mapPolicy(policy), coveragePlans: plans.map(mapPlan), products: products.map((item): PolicyProductView => ({ ...mapProduct(item), benefits: item.benefits.map(mapBenefit) })), insuredCount: policy.insuredCount ?? insuredCount };
}

export async function listPolicyInsuredsDb(policyId: string, query: ListPolicyInsuredsQuery = {}) {
  const policy = await prisma.policy.findUnique({ where: { id: policyId } }); if (!policy) return null;
  const settings = pageSettings(query.page, query.pageSize); const personIds = await matchingPersonIds(query.insuredName?.trim(), query.insuredIdNo?.trim());
  const where = { policyId, coveragePlanId: query.coveragePlanId || undefined, insuredPersonId: personIds ? { in: personIds } : undefined };
  const total = await prisma.policyInsured.count({ where }); const totalPages = Math.max(1, Math.ceil(total / settings.pageSize)); const page = Math.min(settings.page, totalPages);
  const items = await prisma.policyInsured.findMany({ where, orderBy: { id: "asc" }, skip: (page - 1) * settings.pageSize, take: settings.pageSize, include: { insuredPerson: true, coveragePlan: true } });
  return { policyId: policy.id, policyNo: policy.policyNo, items: items.map((item) => mapPolicyInsured(item, item.insuredPerson, item.coveragePlan)), total, page, pageSize: settings.pageSize, totalPages };
}

export async function queryUnderwritingDb(input: QueryUnderwritingInput) {
  const policyNo = input.policyNo?.trim(); const insuredName = input.insuredName?.trim(); const insuredIdNo = input.insuredIdNo?.trim().toUpperCase();
  if (!policyNo && !insuredName && !insuredIdNo) return { total: 0, matches: [], reason: "query_condition_required" };
  const personIds = await matchingPersonIds(insuredName, insuredIdNo);
  const rows = await prisma.policyInsured.findMany({ where: { insuredPersonId: personIds ? { in: personIds } : undefined, policy: policyNo ? { policyNo } : undefined }, include: { policy: true, insuredPerson: true, coveragePlan: true }, orderBy: { id: "asc" } });
  const matches = rows.map((item) => ({ policy: { id: item.policy.id, policyNo: item.policy.policyNo, policyName: item.policy.policyName ?? undefined, applicantName: item.policy.applicantName, policyStatus: item.policy.policyStatus, effectiveDate: dateOnly(item.policy.effectiveDate), expiryDate: dateOnly(item.policy.expiryDate), insuredCount: item.policy.insuredCount ?? 0 }, policyInsured: { id: item.id, effectiveDate: dateOnly(item.effectiveDate), expiryDate: dateOnly(item.expiryDate), coveragePlanId: item.coveragePlanId ?? undefined }, insuredPerson: { id: item.insuredPerson.id, insuredNo: item.insuredPerson.insuredNo, name: item.insuredPerson.name, gender: item.insuredPerson.gender ?? undefined, birthDate: optionalDate(item.insuredPerson.birthDate), idType: item.insuredPerson.idType ?? undefined, idNo: item.insuredPerson.idNo ?? undefined, phone: item.insuredPerson.phone ?? undefined }, coveragePlan: item.coveragePlan ? { id: item.coveragePlan.id, planCode: item.coveragePlan.planCode, planName: item.coveragePlan.planName } : undefined }));
  return { total: matches.length, matches: matches.slice(0, 10), truncated: matches.length > 10 };
}

export async function getCalculationConfigDataDb(): Promise<{ catalog: CalculationConfigCatalog; policies: Policy[] }> {
  const [policies, plans, products, benefits] = await Promise.all([prisma.policy.findMany({ orderBy: { policyNo: "asc" } }), prisma.coveragePlan.findMany({ orderBy: { planCode: "asc" } }), prisma.policyProduct.findMany({ orderBy: { productNo: "asc" } }), prisma.policyBenefit.findMany({ orderBy: { benefitNo: "asc" } })]);
  const policyById = new Map(policies.map((item) => [item.id, item])); const planById = new Map(plans.map((item) => [item.id, item])); const productById = new Map(products.map((item) => [item.id, item]));
  return { policies: policies.map(mapPolicy), catalog: { policy: policies.map((item) => ({ id: item.id, code: item.policyNo, name: item.policyName ?? item.applicantName, parentLabel: item.applicantName, policyId: item.id })), plan: plans.map((item) => ({ id: item.id, code: item.planCode, name: item.planName, parentLabel: policyById.get(item.policyId)?.policyNo, policyId: item.policyId, planId: item.id })), product: products.map((item) => ({ id: item.id, code: item.productCode, name: item.productName, parentLabel: item.coveragePlanId ? planById.get(item.coveragePlanId)?.planName : undefined, policyId: item.policyId, planId: item.coveragePlanId ?? undefined, productId: item.id })), benefit: benefits.map((item) => { const product = productById.get(item.policyProductId)!; const plan = product.coveragePlanId ? planById.get(product.coveragePlanId) : undefined; return { id: item.id, code: item.benefitCode, name: item.benefitName, parentLabel: product.productName, policyId: product.policyId, planId: plan?.id, productId: product.id }; }) } };
}
