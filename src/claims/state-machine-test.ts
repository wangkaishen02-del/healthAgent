import assert from "node:assert/strict";
import {
  CLAIM_STATUS_SEQUENCE,
  CLAIM_TRANSITION_RULES,
  claimTransitionFor,
  isClaimCaseEditable,
  requireClaimTransition,
} from "./state-machine.ts";

assert.deepEqual(CLAIM_STATUS_SEQUENCE, ["registered", "entering", "calculating", "reviewing", "completed"]);

const forward = [
  ["registered", "submit", "entering"],
  ["entering", "calculate", "calculating"],
  ["calculating", "submit_review", "reviewing"],
  ["reviewing", "complete", "completed"],
] as const;
for (const [from, action, to] of forward) assert.equal(requireClaimTransition(from, action).to, to);

assert.equal(requireClaimTransition("entering", "rollback").to, "registered");
assert.equal(requireClaimTransition("calculating", "rollback_calculation").to, "entering");
assert.equal(requireClaimTransition("reviewing", "rollback").to, "calculating");
assert.equal(requireClaimTransition("completed", "rollback").to, "reviewing");
assert.throws(() => requireClaimTransition("calculating", "rollback"), /claim_calculation_rollback_required/);
assert.throws(() => requireClaimTransition("completed", "complete"), /claim_case_status_locked/);
assert.equal(claimTransitionFor("completed", "cancel"), undefined);

for (const status of ["registered", "entering", "calculating", "reviewing"] as const) {
  assert.equal(requireClaimTransition(status, "cancel").to, "cancelled");
}
assert.equal(requireClaimTransition("calculating", "cancel").executor, "workflow");
assert.equal(requireClaimTransition("reviewing", "cancel").executor, "workflow");
assert.deepEqual(requireClaimTransition("registered", "cancel").roles, ["claim_acceptor"]);
assert.deepEqual(requireClaimTransition("calculating", "cancel").roles, ["claim_calculator"]);
assert.deepEqual(requireClaimTransition("reviewing", "cancel").roles, ["claim_reviewer"]);

assert.equal(isClaimCaseEditable("registered", "acceptance"), true);
assert.equal(isClaimCaseEditable("entering", "acceptance"), true);
assert.equal(isClaimCaseEditable("calculating", "acceptance"), false);
assert.equal(isClaimCaseEditable("entering", "calculation"), true);
assert.equal(isClaimCaseEditable("calculating", "calculation"), false);
assert.equal(new Set(CLAIM_TRANSITION_RULES.map((rule) => `${rule.from}:${rule.action}`)).size, CLAIM_TRANSITION_RULES.length);

console.log("Claim state machine tests passed");
