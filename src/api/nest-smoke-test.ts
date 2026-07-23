import "reflect-metadata";
import "../../apps/api/src/load-env.ts";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/src/app.module.ts";
import { buildSystemPrompt, getAssistantPromptMetrics, isDataMutationRequest } from "../assistant/plan-service.ts";
import { getCompactPageRegistration, getPageRegistration } from "../assistant/page-registry.ts";
import { normalizeAssistantModelToolCall } from "../assistant/policy-query-assistant.ts";

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
assert.match(buildSystemPrompt("查询所有案件"), /案件号与保单号必须严格区分/);
assert.match(buildSystemPrompt("清空受理立案页面"), /不需要定位业务对象/);
assert.equal(getAssistantPromptMetrics(["中".repeat(12_000)]).level, "large");
assert.equal(normalizeAssistantModelToolCall({ tool: "query_underwriting", args: {} }), null);

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix("api");

try {
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();
  const paths = [
    "/api/health",
    "/api/policies?page=1&pageSize=1",
    "/api/claim-registrations?page=1&pageSize=1",
    "/api/calculation-parameters",
    "/api/assistant/registry?resource=tools",
    "/api/assistant/registry?resource=page&view=compact&pageId=claim_registration",
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

  const form = new FormData();
  form.append("category", "identity");
  form.append("file", new File([new Uint8Array([1, 2, 3])], "smoke-test.png", { type: "image/png" }));
  const uploadResponse = await fetch(`${baseUrl}/api/claim-attachments`, { method: "POST", body: form });
  assert.equal(uploadResponse.status, 201, "attachment upload should return 201");
  const upload = await uploadResponse.json() as { uploadId: string };
  const deleteResponse = await fetch(`${baseUrl}/api/claim-attachments?uploadId=${encodeURIComponent(upload.uploadId)}`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 200, "attachment delete should return 200");

  console.log("NestJS API smoke tests passed");
} finally {
  await app.close();
}
