import "reflect-metadata";
import "../../apps/api/src/load-env.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/src/app.module.ts";
import { buildSystemPrompt, getAssistantPromptMetrics, isDataMutationRequest, requestAgentPlan } from "../assistant/plan-service.ts";
import { getCompactPageRegistration, getPageRegistration } from "../assistant/page-registry.ts";
import { normalizeAssistantModelToolCall } from "../assistant/policy-query-assistant.ts";
import { canAccessAssistantPage, filterAssistantMenus } from "../assistant/access-control.ts";
import { getNavigationRegistry } from "../assistant/page-registry.ts";

assert.equal(isDataMutationRequest("打开保单理算配置并查询保单 GI2026000001，不要修改参数"), false);
assert.equal(isDataMutationRequest("只查看保单理算配置"), false);
assert.equal(isDataMutationRequest("为住院责任配置免赔额500元"), true);
assert.equal(isDataMutationRequest("新增一个理算参数"), true);
assert.equal(isDataMutationRequest("放弃刚才未保存的修改，重置受理立案页面"), false);
assert.equal(isDataMutationRequest("清空受理立案页面"), false);

const compactRegistration = JSON.stringify(getCompactPageRegistration("claim_registration"));
const fullRegistration = JSON.stringify(getPageRegistration("claim_registration"));
assert.ok(compactRegistration.length < fullRegistration.length * 0.65);
assert.ok(buildSystemPrompt("查询张晨的保单").length < 4_000);
assert.ok(buildSystemPrompt("在录入与理算页面查找案件 CL202610070523 并打开").length < 4_000);
assert.match(buildSystemPrompt("查询所有案件"), /案件号与保单号必须严格区分/);
assert.match(buildSystemPrompt("清空受理立案页面"), /不需要定位业务对象/);
assert.equal(getAssistantPromptMetrics(["中".repeat(12_000)]).level, "large");
assert.equal(normalizeAssistantModelToolCall({ tool: "query_underwriting", args: {} }), null);
assert.equal(canAccessAssistantPage("claim_registration", ["claim_acceptor"]), true);
assert.equal(canAccessAssistantPage("claim_registration", ["claim_viewer"]), false);
assert.equal(canAccessAssistantPage("calculation_config", ["claim_admin"]), true);
assert.equal(filterAssistantMenus(getNavigationRegistry().menus, ["claim_reviewer"])
  .flatMap((menu) => menu.pages).some((page) => page.pageId === "claim_registration"), false);

const lockedOperationPlan = await requestAgentPlan("打开新增账单表单", "deepseek", {
  lastOperationResult: { type: "operation_error", reason: "calculation_data_locked" },
});
assert.equal(lockedOperationPlan.ok, true);
assert.equal(lockedOperationPlan.plan.decision, "finish");
assert.equal(lockedOperationPlan.plan.toolCalls.length, 0);
assert.match(lockedOperationPlan.plan.reply, /先执行理算回退/);

const forbiddenPagePlan = await requestAgentPlan("打开受理立案页面", "deepseek", {
  actorRoles: ["claim_viewer"],
});
assert.equal(forbiddenPagePlan.ok, true);
assert.equal(forbiddenPagePlan.plan.toolCalls.length, 0);
assert.match(forbiddenPagePlan.plan.reply, /没有访问该页面/);

const app = await NestFactory.create(AppModule, { logger: ["error"] });
app.setGlobalPrefix("api");

try {
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();
  const paths = [
    "/api/health",
    "/api/auth/me",
    "/api/policies?page=1&pageSize=1",
    "/api/claim-registrations?page=1&pageSize=1",
    "/api/calculation-parameters",
    "/api/assistant/registry?resource=tools",
    "/api/assistant/registry?resource=page&view=compact&pageId=claim_registration",
    "/api/audit-logs?page=1&pageSize=1",
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, `${path} should return 200`);
  }

  const invalidPlan = await fetch(`${baseUrl}/api/assistant/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "测试", provider: "invalid" }),
  });
  assert.equal(invalidPlan.status, 400, "invalid assistant provider should return 400");

  const operationKey = `nest-smoke-${randomUUID()}`;
  const createUploadForm = () => {
    const form = new FormData();
    form.append("category", "identity");
    form.append("file", new File([new Uint8Array([1, 2, 3])], "smoke-test.png", { type: "image/png" }));
    return form;
  };
  const uploadResponse = await fetch(`${baseUrl}/api/claim-attachments`, {
    method: "POST",
    body: createUploadForm(),
  });
  assert.equal(uploadResponse.status, 201, "attachment upload should return 201");
  const upload = await uploadResponse.json() as { uploadId: string };
  const previewResponse = await fetch(`${baseUrl}/api/claim-attachments?uploadId=${encodeURIComponent(upload.uploadId)}`);
  assert.equal(previewResponse.status, 200, "attachment preview should return 200");
  assert.equal(previewResponse.headers.get("content-type"), "image/png", "attachment preview should preserve content type");
  assert.equal((await previewResponse.arrayBuffer()).byteLength, 3, "attachment preview should return original bytes");
  const deleteUrl = `${baseUrl}/api/claim-attachments?uploadId=${encodeURIComponent(upload.uploadId)}`;
  const deleteResponse = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { "Idempotency-Key": `${operationKey}:delete` },
  });
  assert.equal(deleteResponse.status, 200, "attachment delete should return 200");
  const repeatedDeleteResponse = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { "Idempotency-Key": `${operationKey}:delete` },
  });
  assert.equal(repeatedDeleteResponse.status, 200, "repeated idempotent delete should return 200");
  const missingDeleteResponse = await fetch(
    `${baseUrl}/api/claim-attachments?uploadId=${randomUUID()}`,
    {
      method: "DELETE",
      headers: { "Idempotency-Key": `${operationKey}:delete-missing` },
    },
  );
  assert.equal(missingDeleteResponse.status, 200, "deleting missing attachment bytes should be idempotent");

  let audited = false;
  for (let attempt = 0; attempt < 20 && !audited; attempt += 1) {
    const auditResponse = await fetch(`${baseUrl}/api/audit-logs?page=1&pageSize=20&resourceType=claim-attachments`);
    const auditData = await auditResponse.json() as { items?: Array<{ actorUserId?: string; outcome?: string }> };
    audited = auditData.items?.some((item) => item.actorUserId === "default-user" && item.outcome === "success") ?? false;
    if (!audited) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(audited, true, "successful mutations should create an operation audit record");

  console.log("NestJS API smoke tests passed");
} finally {
  await app.close();
}
