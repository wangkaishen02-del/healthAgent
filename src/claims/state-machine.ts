import type { ClaimCaseStatus, ClaimTransitionAction } from "./types.ts";

export const CLAIM_STATUS_SEQUENCE = ["registered", "entering", "calculating", "reviewing", "completed"] as const;
export const CLAIM_CASE_STATUSES = [...CLAIM_STATUS_SEQUENCE, "cancelled"] as const;

export const CLAIM_STATUS_LABELS: Record<ClaimCaseStatus, string> = {
  registered: "受理",
  entering: "录入",
  calculating: "理算",
  reviewing: "审核",
  completed: "结案",
  cancelled: "已撤件",
};

export type ClaimWorkflowAction = "submit" | "calculate" | "submit_review" | "complete" | "cancel" | "rollback" | "rollback_calculation";
export type ClaimDirectWorkflowAction = Exclude<ClaimWorkflowAction, "calculate" | "rollback_calculation">;
export type ClaimEditArea = "acceptance" | "calculation";
export type ClaimWorkflowRole = "claim_acceptor" | "claim_calculator" | "claim_reviewer";

export interface ClaimTransitionRule {
  from: ClaimCaseStatus;
  action: ClaimWorkflowAction;
  to: ClaimCaseStatus;
  transitionAction: ClaimTransitionAction;
  description: string;
  executor: "claims" | "calculation" | "workflow";
  roles: readonly ClaimWorkflowRole[];
}

const forwardRules: ClaimTransitionRule[] = [
  { from: "registered", action: "submit", to: "entering", transitionAction: "submit", description: "受理提交", executor: "claims", roles: ["claim_acceptor"] },
  { from: "entering", action: "calculate", to: "calculating", transitionAction: "calculate", description: "完成理算", executor: "calculation", roles: ["claim_calculator"] },
  { from: "calculating", action: "submit_review", to: "reviewing", transitionAction: "submit_review", description: "提交审核", executor: "claims", roles: ["claim_calculator"] },
  { from: "reviewing", action: "complete", to: "completed", transitionAction: "complete", description: "审核结案", executor: "claims", roles: ["claim_reviewer"] },
];

const rollbackRules: ClaimTransitionRule[] = [
  { from: "entering", action: "rollback", to: "registered", transitionAction: "rollback", description: "流程回退", executor: "claims", roles: ["claim_calculator"] },
  { from: "calculating", action: "rollback_calculation", to: "entering", transitionAction: "rollback_calculation", description: "理算回退", executor: "calculation", roles: ["claim_calculator"] },
  { from: "reviewing", action: "rollback", to: "calculating", transitionAction: "rollback", description: "流程回退", executor: "claims", roles: ["claim_reviewer"] },
  { from: "completed", action: "rollback", to: "reviewing", transitionAction: "rollback", description: "流程回退", executor: "claims", roles: ["claim_reviewer"] },
];

const cancellationRules: ClaimTransitionRule[] = [
  { from: "registered", action: "cancel", to: "cancelled", transitionAction: "cancel", description: "案件撤件", executor: "claims", roles: ["claim_acceptor"] },
  { from: "entering", action: "cancel", to: "cancelled", transitionAction: "cancel", description: "案件撤件", executor: "claims", roles: ["claim_calculator"] },
  { from: "calculating", action: "cancel", to: "cancelled", transitionAction: "cancel", description: "回退理算并撤件", executor: "workflow", roles: ["claim_calculator"] },
  { from: "reviewing", action: "cancel", to: "cancelled", transitionAction: "cancel", description: "回退理算并撤件", executor: "workflow", roles: ["claim_reviewer"] },
];

export const CLAIM_TRANSITION_RULES = [...forwardRules, ...rollbackRules, ...cancellationRules] as const;

const transitionByKey = new Map(CLAIM_TRANSITION_RULES.map((rule) => [`${rule.from}:${rule.action}`, rule]));

export function claimTransitionFor(status: ClaimCaseStatus, action: ClaimWorkflowAction): ClaimTransitionRule | undefined {
  return transitionByKey.get(`${status}:${action}`);
}

export function requireClaimTransition(status: ClaimCaseStatus, action: ClaimWorkflowAction): ClaimTransitionRule {
  const transition = claimTransitionFor(status, action);
  if (transition) return transition;
  if (status === "calculating" && action === "rollback") throw new Error("claim_calculation_rollback_required");
  if (action === "calculate") throw new Error("claim_case_not_entering");
  if (action === "rollback_calculation") throw new Error("claim_case_not_calculating");
  if (action === "rollback") throw new Error("claim_case_rollback_not_allowed");
  throw new Error("claim_case_status_locked");
}

export function isClaimCaseEditable(status: ClaimCaseStatus, area: ClaimEditArea) {
  return area === "acceptance"
    ? status === "registered" || status === "entering"
    : status === "entering";
}

export function requireClaimCaseEditable(status: ClaimCaseStatus, area: ClaimEditArea) {
  if (isClaimCaseEditable(status, area)) return;
  throw new Error(area === "acceptance" ? "claim_case_not_editable" : "claim_case_not_entering");
}
