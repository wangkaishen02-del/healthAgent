import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { transitionClaimCaseDb } from "../claims/prisma-service.ts";
import { ClaimsService } from "../../apps/api/src/claims/claims.service.ts";
import { ClaimRegistrationsController } from "../../apps/api/src/claims/claim-registrations.controller.ts";
import { IdempotencyService } from "../../apps/api/src/idempotency/idempotency.service.ts";
import { PrismaLifecycleService } from "../../apps/api/src/prisma/prisma-lifecycle.service.ts";

const fixture = await prisma.claimCase.findFirst({
  select: {
    policyId: true,
    policyInsuredId: true,
    insuredPersonId: true,
    eventId: true,
    reportDate: true,
    reportChannel: true,
  },
});
assert(fixture, "claim workflow test requires seeded claim data");

const claimCaseId = randomUUID();
const creator = { userId: "workflow-acceptor", userName: "流转受理员" };
const calculator = { userId: "workflow-calculator", userName: "流转理算员" };
const reviewer = { userId: "workflow-reviewer", userName: "流转审核员" };
const submitOperationKey = `workflow-submit-${randomUUID()}`;

try {
  await prisma.claimCase.create({
    data: {
      id: claimCaseId,
      caseNo: `CLWF${Date.now()}`,
      ...fixture,
      currentHandlerUserId: creator.userId,
      currentHandlerName: creator.userName,
    },
  });
  await prisma.claimCaseTransition.create({
    data: {
      id: randomUUID(),
      claimCaseId,
      action: "create",
      toStatus: "registered",
      operatorUserId: creator.userId,
      operatorName: creator.userName,
      targetUserId: creator.userId,
      targetUserName: creator.userName,
    },
  });

  const controller = new ClaimRegistrationsController(new ClaimsService(), new IdempotencyService(new PrismaLifecycleService()));
  const acceptorUser = { id: creator.userId, username: creator.userId, displayName: creator.userName, roles: ["claim_acceptor" as const] };
  const submitBody = { id: claimCaseId, action: "submit" };
  assert.equal((await controller.changeStatus(submitBody, acceptorUser, submitOperationKey))?.status, "entering");
  assert.equal((await controller.changeStatus(submitBody, acceptorUser, submitOperationKey))?.status, "entering");
  const acceptanceRollback = await transitionClaimCaseDb(claimCaseId, "rollback", calculator);
  assert.equal(acceptanceRollback?.status, "registered");
  assert.equal(acceptanceRollback?.currentHandlerUserId, creator.userId);

  await transitionClaimCaseDb(claimCaseId, "submit", creator);
  await prisma.claimCase.update({ where: { id: claimCaseId }, data: { status: "calculating", currentHandlerUserId: calculator.userId, currentHandlerName: calculator.userName } });
  await prisma.claimCaseTransition.create({
    data: {
      id: randomUUID(), claimCaseId, action: "calculate", fromStatus: "entering", toStatus: "calculating",
      operatorUserId: calculator.userId, operatorName: calculator.userName, targetUserId: calculator.userId, targetUserName: calculator.userName,
    },
  });

  assert.equal((await transitionClaimCaseDb(claimCaseId, "submit_review", calculator))?.status, "reviewing");
  assert.equal((await transitionClaimCaseDb(claimCaseId, "complete", reviewer))?.status, "completed");
  const completionRollback = await transitionClaimCaseDb(claimCaseId, "rollback", reviewer);
  assert.equal(completionRollback?.status, "reviewing");
  assert.equal(completionRollback?.currentHandlerUserId, reviewer.userId);
  assert.equal((await prisma.claimCaseTransition.count({ where: { claimCaseId } })), 8);
  await assert.rejects(() => transitionClaimCaseDb(claimCaseId, "submit", creator), /claim_case_status_locked/);
  const cancelled = await new ClaimsService().cancelCase(claimCaseId, reviewer);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal((await prisma.claimCaseTransition.count({ where: { claimCaseId } })), 11);
} finally {
  await prisma.claimCaseTransition.deleteMany({ where: { claimCaseId } });
  await prisma.claimCase.deleteMany({ where: { id: claimCaseId } });
  await prisma.idempotencyRecord.deleteMany({ where: { operationKey: submitOperationKey } });
  await prisma.$disconnect();
}

console.log("Claim workflow database tests passed");
