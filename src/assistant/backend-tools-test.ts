import assert from "node:assert/strict";
import { prisma } from "../db/prisma.ts";
import { executeAssistantBackendTool } from "./plan-service.ts";
import { normalizeAssistantModelToolCall } from "./policy-query-assistant.ts";

const sourceCase = await prisma.claimCase.findFirst({ where: { status: "entering" }, orderBy: { createdAt: "asc" } });
assert(sourceCase, "seed data must contain an entering claim case");
const sourceRelationship = await prisma.policyInsured.findFirst({ include: { policy: true }, orderBy: { createdAt: "asc" } });
assert(sourceRelationship, "seed data must contain an underwriting relationship");

const underwriting = await executeAssistantBackendTool({
  tool: "query_underwriting",
  args: { policyNo: sourceRelationship.policy.policyNo },
});
assert.equal(underwriting.type, "underwriting_query_result");
if (!("matches" in underwriting) || !("policySummaries" in underwriting)) throw new Error("underwriting query shape missing");
assert.equal(underwriting.relationshipCount, underwriting.total, "total must explicitly mean relationship count");
assert.equal(underwriting.distinctPolicyCount, underwriting.policySummaries.length, "distinct policy count must use grouped summaries");
assert.equal(underwriting.distinctPolicyCount, 1, "a policy-number query must group all relationships into one policy summary");

const normalizedInspection = normalizeAssistantModelToolCall({
  tool: "inspect_claim_case",
  args: { caseNo: sourceCase.caseNo.toLowerCase() },
});
assert.deepEqual(normalizedInspection, { tool: "inspect_claim_case", args: { caseNo: sourceCase.caseNo } });
assert.equal(
  normalizeAssistantModelToolCall({ tool: "inspect_claim_case", args: { caseNo: "<CASE_NO_N>" } }),
  null,
  "an unresolved case-number placeholder must never reach the inspection tool",
);

const inspection = await executeAssistantBackendTool(normalizedInspection, ["claim_calculator"]);
assert.equal(inspection.type, "claim_case_inspection");
if (!("found" in inspection) || inspection.found !== true || !("workflowActions" in inspection)) throw new Error("claim inspection missing");
assert.equal(inspection.caseNo, sourceCase.caseNo);
assert.equal(inspection.status, "entering");
assert.equal(inspection.editableAreas.calculation, true);
assert(inspection.workflowActions.some((action) => action.action === "calculate"));
assert(inspection.businessNextActions.some((action) => action.action === "calculate" && action.allowedForCurrentUser));
assert.equal(typeof inspection.dataSummary.billCount, "number");
assert(!("rawText" in inspection.dataSummary), "inspection must not expose OCR source text");

const viewerInspection = await executeAssistantBackendTool(
  { tool: "inspect_claim_case", args: { caseNo: sourceCase.caseNo } },
  ["claim_viewer"],
);
if (!("found" in viewerInspection) || viewerInspection.found !== true || !("workflowActions" in viewerInspection)) throw new Error("viewer inspection missing");
assert.deepEqual(viewerInspection.workflowActions, [], "read-only roles must not receive workflow actions");
assert(viewerInspection.businessNextActions.some((action) => action.action === "calculate" && !action.allowedForCurrentUser));
assert.equal(viewerInspection.recommendedPage, "claim_query", "read-only roles should stay on an accessible page");

const missingInspection = await executeAssistantBackendTool(
  { tool: "inspect_claim_case", args: { caseNo: "CL-NOT-FOUND" } },
  ["claim_viewer"],
);
assert("found" in missingInspection && missingInspection.found === false);

const summary = await executeAssistantBackendTool({ tool: "summarize_claim_work_queue", args: {} }, ["claim_viewer"]);
assert.equal(summary.type, "claim_work_queue_summary");
if (!("stages" in summary) || !("ocr" in summary) || !("activeTotal" in summary)) throw new Error("work queue summary missing");
assert(summary.total >= 1);
assert.equal(summary.stages.reduce((total, stage) => total + stage.count, 0), summary.total);
assert.equal(summary.stages.length, 6);
assert.equal(typeof summary.ocr.failed, "number");

assert.equal(normalizeAssistantModelToolCall({ tool: "summarize_claim_work_queue", args: { ignored: true } })?.tool, "summarize_claim_work_queue");

console.log("Assistant backend capability tests passed");
