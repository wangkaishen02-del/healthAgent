import { handleGetRequest } from "./server.ts";
import {
  createCalculationParameter,
  deleteCalculationParameter,
  getCalculationConfigCatalog,
  listCalculationParameters,
  queryUnderwriting,
} from "../underwriting/service.ts";
import { formatToolCall, formatToolInvocation, isAssistantBackendCall, isAssistantToolCall, isAssistantUserInputCall } from "../assistant/policy-query-assistant.ts";
import { getAssistantBackendToolCatalog, getRegisteredAction, getRegisteredField } from "../assistant/page-registry.ts";
import { changeClaimCaseStatus, createClaimCase, createClaimEvent, listClaimCases, listClaimEvents, updateClaimCase, updateClaimEvent } from "../claims/service.ts";
import type { ClaimPartySnapshot, CreateClaimCaseInput } from "../claims/types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const urls = [
  "/api/health",
  "/api/policies?page=1&pageSize=2",
  "/api/policies/policy-001",
  "/api/policies/policy-001/products",
  "/api/policies/policy-001/insureds?page=2&pageSize=10",
  "/api/policies/policy-001/full-view",
];

for (const url of urls) {
  const response = handleGetRequest(url);
  assert(response.status === 200, `${url} 应返回 200`);
  console.log(url, response.status);
}

const policies = handleGetRequest("/api/policies?page=1&pageSize=2").payload as {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
};
assert(policies.items.length === 2, "保单接口应仅返回当前页 2 条数据");
assert(policies.total === 3 && policies.page === 1 && policies.pageSize === 2, "保单分页元数据不正确");

const insureds = handleGetRequest("/api/policies/policy-001/insureds?page=2&pageSize=10").payload as {
  items: Array<{ coveragePlanId?: string; coveragePlan?: { id: string } }>;
  total: number;
  page: number;
};
assert(insureds.items.length === 10, "被保人接口第 2 页应仅返回 10 条数据");
assert(insureds.total === 20 && insureds.page === 2, "被保人分页元数据不正确");
assert(insureds.items.every((item) => item.coveragePlanId && item.coveragePlan?.id), "被保人应返回关联的保障计划");

const planInsureds = handleGetRequest("/api/policies/policy-001/insureds?coveragePlanId=plan-001&page=1&pageSize=20").payload as {
  items: Array<{ coveragePlanId?: string }>;
  total: number;
};
assert(planInsureds.total === 14, "保障计划筛选应返回计划下的被保人总数");
assert(planInsureds.items.every((item) => item.coveragePlanId === "plan-001"), "保障计划筛选结果不正确");

const namedInsureds = handleGetRequest("/api/policies/policy-001/insureds?insuredName=%E9%99%88%E6%B5%A9&page=1&pageSize=10").payload as {
  items: Array<{ id: string; insuredPerson: { id: string; name: string; idNo?: string } }>;
  total: number;
};
assert(namedInsureds.total === 1, "按姓名查询应精确返回陈浩的承保关系");
assert(namedInsureds.items[0].insuredPerson.idNo === "310101199309210055", "人员查询结果应向 Agent 提供证件号");
const underwritingMatches = queryUnderwriting({ insuredName: "陈浩" });
assert(underwritingMatches.total === 1, "后台承保查询应唯一命中陈浩");
assert(underwritingMatches.matches[0].policy.policyNo === "GI2026000001", "后台承保查询应返回保单号");
assert(getAssistantBackendToolCatalog().some((item) => item.tool === "query_underwriting"), "后台承保查询工具应加入工具目录");
assert(isAssistantBackendCall({ tool: "query_underwriting", args: { insuredName: "陈浩" } }), "Agent 应接受后台承保查询工具");
assert(isAssistantUserInputCall({ tool: "ask_user", args: { question: "事故发生日期是哪一天？", requestedFields: ["occurredDate"] } }), "Agent 应接受中途追问工具");
assert(formatToolInvocation("query_underwriting", { insuredName: "陈浩", policyNo: undefined }) === "查询承保信息{被保人姓名：陈浩}", "工具记录应使用中文名称并隐藏未提供的可选参数");

const detail = handleGetRequest("/api/policies/policy-001/full-view").payload as {
  coveragePlans?: unknown[];
  insuredCount?: number;
  insureds?: unknown;
};
assert(detail.insuredCount === 20, "详情接口应返回被保人总数");
assert(detail.coveragePlans?.length === 2, "详情接口应返回保单下的保障计划");
assert(detail.insureds === undefined, "详情接口不应携带全量被保人清单");

console.log("pagination assertions passed");

const calculationCatalog = getCalculationConfigCatalog();
assert(calculationCatalog.policy.length === 3, "理算配置应提供保单配置对象");
assert(calculationCatalog.plan.length === 4, "理算配置应提供保障计划配置对象");
assert(calculationCatalog.product.length === 8, "理算配置应提供险种配置对象");
assert(calculationCatalog.benefit.length === 16, "理算配置应提供责任配置对象");

const smokeParameter = createCalculationParameter({
  scope: "benefit",
  targetId: "benefit-001",
  definitionCode: "MAX_PAYMENT_DAYS",
  parameterValue: "1",
  enabled: true,
});
assert(listCalculationParameters("benefit", "benefit-001").some((item) => item.id === smokeParameter.id), "理算参数应能保存");
assert(deleteCalculationParameter(smokeParameter.id), "理算参数应能删除");

console.log("calculation configuration assertions passed");

const baseParty: Omit<ClaimPartySnapshot, "role"> = {
  name: "张晨",
  gender: "male",
  birthDate: "1990-03-12",
  idType: "id_card",
  idNo: "310101199003120011",
  idValidFrom: "2020-01-01",
  idValidTo: "2040-01-01",
  idLongTerm: false,
  address: "上海市",
  phone: "13800000001",
};
const smokeEvent = createClaimEvent("insured-001", {
  eventType: "disease",
  occurredDate: "2026-07-18",
  administrativeArea: "上海市 / 上海市 / 浦东新区",
  detailedAddress: "示例路100号",
  hospitalName: "示例医院",
  diagnosis: "门诊治疗",
  description: "API 烟测立案事件",
});
assert(listClaimEvents({ insuredPersonId: "insured-001" }).some((item) => item.id === smokeEvent.id), "人员事件应能新增和查询");
assert(listClaimEvents({ insuredPersonId: "insured-001", keyword: "浦东" }).length === 1, "人员事件应支持关键词筛选");
assert(listClaimEvents({ insuredPersonId: "insured-001", eventType: "accident" }).every((item) => item.eventType === "accident"), "人员事件应支持类型筛选");
assert(listClaimEvents({ insuredPersonId: "insured-001", occurredDate: "2026-07-18" }).length === 1, "人员事件应支持日期筛选");
const updatedSmokeEvent = updateClaimEvent(smokeEvent.id, "insured-001", { ...smokeEvent, description: "API 烟测事件已修改" });
assert(updatedSmokeEvent.description === "API 烟测事件已修改", "人员事件应支持修改");
const smokeClaimInput: CreateClaimCaseInput = {
  policyId: "policy-001",
  policyInsuredId: "policy-insured-001",
  reportDate: "2026-07-19",
  reportChannel: "online",
  parties: [
    { ...baseParty, role: "insured", relationToInsured: "本人" },
    { ...baseParty, role: "applicant", relationToInsured: "本人" },
    { ...baseParty, role: "payee", relationToInsured: "本人", paymentMethod: "bank_transfer", bankName: "示例银行", bankAccountName: "张晨", bankAccountNo: "6222000000000000" },
  ],
  eventId: smokeEvent.id,
  attachments: [],
};
const smokeClaim = createClaimCase(smokeClaimInput);
assert(listClaimCases().some((item) => item.id === smokeClaim.id), "受理立案应能创建案件并生成案件号");
assert(smokeClaim.caseNo.startsWith("CL"), "立案案件号应使用统一前缀");
const updatedClaim = updateClaimCase(smokeClaim.id, { ...smokeClaimInput, remark: "已修改" });
assert(updatedClaim !== null, "应能找到待修改的案件");
assert(updatedClaim.remark === "已修改", "已立案案件应能保存修改");
const submittedClaim = changeClaimCaseStatus(smokeClaim.id, "submitted");
assert(submittedClaim !== null, "应能找到待提交的案件");
assert(submittedClaim.status === "submitted", "已立案案件应能提交");
const cancelledClaim = changeClaimCaseStatus(createClaimCase(smokeClaimInput).id, "cancelled");
assert(cancelledClaim !== null, "应能找到待撤件的案件");
assert(cancelledClaim.status === "cancelled", "已立案案件应能撤件");
console.log("claim registration assertions passed");

const runtimeFilter = getRegisteredField("policy_detail", "coveragePlanId");
assert(runtimeFilter?.type === "select" && runtimeFilter.optionSource === "runtime", "详情筛选字段应注册为运行时选项字段");
assert(isAssistantToolCall({
  tool: "set_field",
  args: { pageId: "policy_detail", fieldId: "coveragePlanId", value: "plan-001" },
}), "Agent 应接受已注册详情字段");
assert(isAssistantToolCall({
  tool: "click_button",
  args: { pageId: "policy_detail", actionId: "view_insureds" },
}), "Agent 应接受已注册页面动作");
assert(!isAssistantToolCall({
  tool: "set_field",
  args: { pageId: "policy_detail", fieldId: "unknownField", value: "x" },
}), "Agent 应拒绝未注册字段");
assert(getRegisteredField("calculation_config", "definitionCode")?.optionSource === "runtime", "参数定义应注册为运行时选项字段");
assert(getRegisteredAction("calculation_config", "configure", "row") !== null, "配置对象行操作应完成注册");
assert(isAssistantToolCall({
  tool: "set_field",
  args: { pageId: "calculation_config", fieldId: "parameterValue", value: "500" },
}), "Agent 应接受配置页已注册字段");
assert(isAssistantToolCall({
  tool: "click_button",
  args: { pageId: "calculation_config", actionId: "save_parameter" },
}), "Agent 应接受配置页保存动作");
assert(isAssistantToolCall({
  tool: "click_list_row_action",
  args: { pageId: "calculation_config", actionId: "configure", row: 1 },
}), "Agent 应接受配置对象行操作");
assert(getRegisteredField("claim_registration", "insuredIdNo")?.type === "text", "立案证件号应注册为文本输入");
assert(getRegisteredAction("claim_registration", "lock_insured", "page") !== null, "承保关系锁定动作应完成注册");
assert(getRegisteredAction("claim_registration", "edit_case", "row") !== null, "案件列表打开动作应完成注册");
assert(getRegisteredAction("claim_registration", "save_case", "page") !== null, "案件保存动作应完成注册");
assert(getRegisteredAction("claim_registration", "cancel_case", "page") !== null, "案件撤件动作应完成注册");
assert(getRegisteredAction("claim_registration", "submit_case", "page") !== null, "案件提交动作应完成注册");
assert(getRegisteredField("claim_registration", "payeePaymentMethod")?.type === "select", "领款方式应注册为选择字段");
assert(getRegisteredField("claim_registration", "occurredDate")?.type === "text", "事件发生日期应完成注册");
assert(getRegisteredAction("claim_registration", "create_event", "page") !== null, "新增事件动作应完成注册");
assert(getRegisteredAction("claim_registration", "select_event", "row") !== null, "关联事件行操作应完成注册");
assert(getRegisteredAction("claim_registration", "edit_event", "row") !== null, "编辑事件行操作应完成注册");
assert(getRegisteredField("claim_registration", "eventKeyword")?.type === "text", "事件列表关键词筛选应完成注册");
assert(getRegisteredAction("claim_registration", "reset_event_filters", "page") !== null, "清空事件筛选动作应完成注册");
assert(isAssistantToolCall({
  tool: "click_button",
  args: { pageId: "claim_registration", actionId: "save_case" },
}), "Agent 应接受立案提交动作");
assert(formatToolCall({ tool: "set_field", args: { pageId: "policy_query", fieldId: "insuredName", value: "陈浩" } }) === "填写字段{页面：保单信息查询，字段：被保人姓名，值：陈浩}", "页面执行记录应使用中文工具和参数名称");

console.log("assistant registry assertions passed");
