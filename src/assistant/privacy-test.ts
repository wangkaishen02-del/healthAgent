import assert from "node:assert/strict";
import { ExternalDataProtector, minimizeAssistantData, redactSensitiveText } from "./privacy.ts";

assert.equal(minimizeAssistantData(undefined), undefined);
assert.deepEqual(
  minimizeAssistantData({ currentPagePath: undefined, actorRoles: ["claim_viewer"] }),
  { currentPagePath: undefined, actorRoles: ["claim_viewer"] },
);

const protector = new ExternalDataProtector();
const original = JSON.stringify({
  insuredName: "张晨",
  insuredIdNo: "310101198901140066",
  phone: "13812345678",
  bankAccountNo: "6222021234567890123",
  email: "zhangchen@example.com",
  diagnosisName: "急性胃炎",
  occurredLocation: "上海市浦东新区测试路1号",
  request: "帮我查一下张晨的保单，手机号是13812345678，诊断为急性胃炎，事故地点为上海市浦东新区测试路1号。",
});
const protectedContent = protector.protect(original);

for (const secret of ["张晨", "310101198901140066", "13812345678", "6222021234567890123", "zhangchen@example.com", "急性胃炎", "上海市浦东新区测试路1号"]) {
  assert.equal(protectedContent.includes(secret), false, `${secret} should not leave the service`);
}
assert.match(protectedContent, /<PII_NAME_1>/);
assert.equal(protector.restore(protectedContent), original);
assert.ok(protector.replacementCount >= 5);

const minimized = minimizeAssistantData({
  ocrText: "医疗票据正文".repeat(1_000),
  imageData: "data:image/png;base64,secret",
  items: Array.from({ length: 25 }, (_, index) => ({ index })),
  description: "a".repeat(2_100),
}) as Record<string, unknown>;
assert.match(String(minimized.ocrText), /已裁剪 OCR 正文/);
assert.equal(minimized.imageData, "[已移除文件内容]");
assert.equal((minimized.items as unknown[]).length, 21);
assert.match(String(minimized.description), /已裁剪 100 字符/);

const redacted = redactSensitiveText(original);
assert.equal(redacted.includes("310101198901140066"), false);
assert.equal(redacted.includes("13812345678"), false);
assert.equal(redacted.includes("6222021234567890123"), false);
assert.equal(redacted.includes("zhangchen@example.com"), false);
assert.equal(redacted.includes('"insuredName":"张晨"'), false);

console.log("Assistant privacy tests passed");
