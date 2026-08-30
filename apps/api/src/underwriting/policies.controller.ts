import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { UnderwritingService } from "./underwriting.service.ts";
import { Roles } from "../auth/auth.decorators.ts";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Controller("policies")
@Roles("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer")
export class PoliciesController {
  constructor(@Inject(UnderwritingService) private readonly underwriting: UnderwritingService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.underwriting.listPolicies({
      policyNo: query.policyNo,
      applicantName: query.applicantName,
      insuredName: query.insuredName,
      insuredIdNo: query.insuredIdNo,
      policyStatus: query.policyStatus === "enabled" || query.policyStatus === "disabled" ? query.policyStatus : undefined,
      page: positiveNumber(query.page, 1),
      pageSize: positiveNumber(query.pageSize, 10),
    });
  }

  @Get(":policyId/full-view")
  async detail(@Param("policyId") policyId: string) {
    const result = await this.underwriting.getPolicyDetail(policyId);
    if (!result) throw new NotFoundException("Not Found");
    return result;
  }

  @Get(":policyId/insureds")
  async insureds(@Param("policyId") policyId: string, @Query() query: Record<string, string | undefined>) {
    const result = await this.underwriting.listPolicyInsureds(policyId, {
      coveragePlanId: query.coveragePlanId,
      insuredName: query.insuredName,
      insuredIdNo: query.insuredIdNo,
      page: positiveNumber(query.page, 1),
      pageSize: positiveNumber(query.pageSize, 10),
    });
    if (!result) throw new NotFoundException("Not Found");
    return result;
  }
}
