import "../../apps/api/src/load-env.ts";
import assert from "node:assert/strict";

process.env.ASSISTANT_LOG_LEVEL = "off";

const { requestAgentPlan, setAssistantBackendExecutorForTesting } = await import("./plan-service.ts");

const firstCase = { caseNo: "CL209901010001", status: "entering" };
const secondCase = { caseNo: "CL209901010002", status: "calculating" };
const viewerRoles = ["claim_viewer"];
const operatorRoles = ["claim_acceptor", "claim_calculator", "claim_reviewer"];

setAssistantBackendExecutorForTesting(async (call, roles) => {
  if (call.tool === "inspect_claim_case") {
    const status = call.args.caseNo === secondCase.caseNo ? secondCase.status : firstCase.status;
    return {
      type: "claim_case_inspection",
      found: true,
      caseNo: call.args.caseNo,
      status,
      dataSummary: { attachmentCount: 3, ocrCompleted: 3, ocrFailed: 0, billCount: 1 },
      warnings: [],
      businessNextActions: [{
        action: "calculate",
        label: "完成理算",
        toStatus: "calculating",
        toStatusLabel: "理算",
        allowedForCurrentUser: false,
      }],
      workflowActions: roles?.some((role) => ["claim_acceptor", "claim_calculator", "claim_reviewer"].includes(role))
        ? [{ action: "cancel", label: "案件撤件" }]
        : [],
      recommendedPage: "claim_query",
    };
  }
  if (call.tool === "summarize_claim_work_queue") {
    return {
      type: "claim_work_queue_summary",
      total: 12,
      activeTotal: 10,
      stages: [
        { status: "registered", count: 2 },
        { status: "entering", count: 3 },
        { status: "calculating", count: 2 },
        { status: "reviewing", count: 2 },
        { status: "completed", count: 2 },
        { status: "cancelled", count: 1 },
      ],
      ocr: { queued: 1, processing: 1, succeeded: 20, failed: 2 },
    };
  }
  if (call.tool === "query_claim_cases") {
    const caseNo = call.args.caseNo ?? firstCase.caseNo;
    return {
      type: "claim_case_query_result",
      total: 1,
      items: [{ itemId: `synthetic-${caseNo}`, caseNo, status: firstCase.status }],
      resolvedFields: ["caseId", "caseNo"],
    };
  }
  return { type: "underwriting_query_result", total: 0, items: [], resolvedFields: [] };
});

function planText(result: Awaited<ReturnType<typeof requestAgentPlan>>) {
  assert.equal(result.ok, true);
  return JSON.stringify(result.plan);
}

function hasBackendType(result: Awaited<ReturnType<typeof requestAgentPlan>>, type: string) {
  return result.ok && result.plan.backendToolResults?.some((item) =>
    item && typeof item === "object" && (item as { type?: unknown }).type === type,
  );
}

function requestedFields(result: Awaited<ReturnType<typeof requestAgentPlan>>) {
  if (!result.ok) return [];
  const request = (result.plan as { userInputRequest?: { requestedFields?: string[] } }).userInputRequest;
  return request?.requestedFields ?? [];
}

const inspection = await requestAgentPlan(
  `查看案件 ${firstCase.caseNo} 的资料是否齐全、OCR 情况和下一步，只查询不要修改`,
  "deepseek",
  { actorRoles: viewerRoles },
);
console.log("[案件诊断]", planText(inspection));
assert.equal(hasBackendType(inspection, "claim_case_inspection"), true, "指定案件诊断应调用案件检查工具");
assert.doesNotMatch(planText(inspection), /save_|submit_|cancel_|delete_|remove_/i);
assert.match(planText(inspection), /检查案件资料与流程/, "工具执行记录应显示具体业务名称");
assert.doesNotMatch(inspection.ok ? inspection.plan.reply : "", /无(?:待办|后续|下一步)/, "只读用户无权限不等于业务没有下一步");
assert.match(inspection.ok ? inspection.plan.reply : "", /理算|权限/, "应说明业务下一步或当前账号权限限制");

const queue = await requestAgentPlan(
  "现在各环节分别有多少案件，OCR 队列有没有失败任务？只要汇总，不打开页面",
  "deepseek",
  { actorRoles: viewerRoles },
);
assert.equal(hasBackendType(queue, "claim_work_queue_summary"), true, "队列问题应调用实时汇总工具");

const continued = await requestAgentPlan(
  "继续查看刚才那个案件，告诉我资料是否完整，不要修改",
  "deepseek",
  {
    actorRoles: viewerRoles,
    memory: {
      recentTurns: [{
        taskId: "previous-memory-task",
        userText: `查询案件 ${firstCase.caseNo}`,
        assistantReply: `已找到案件 ${firstCase.caseNo}，当前状态为 ${firstCase.status}。`,
        recognized: [firstCase.caseNo],
        toolCalls: [],
        pagePath: ["综合查询", "案件查询"],
        createdAt: new Date().toISOString(),
      }],
    },
  },
);
assert.match(planText(continued), new RegExp(firstCase.caseNo), "连续指代应使用当前用户最近一轮记忆");

const explicitOverride = await requestAgentPlan(
  `不要看刚才那个了，改为查看案件 ${secondCase.caseNo} 的状态和下一步，只查询`,
  "deepseek",
  {
    actorRoles: viewerRoles,
    memory: {
      recentTurns: [{
        taskId: "stale-memory-task",
        userText: `查询案件 ${firstCase.caseNo}`,
        assistantReply: `已找到案件 ${firstCase.caseNo}。`,
        recognized: [firstCase.caseNo],
        toolCalls: [],
        pagePath: ["综合查询", "案件查询"],
        createdAt: new Date().toISOString(),
      }],
    },
  },
);
assert.match(planText(explicitOverride), new RegExp(secondCase.caseNo), "当前明确案件必须覆盖旧记忆");
assert.doesNotMatch(planText(explicitOverride), new RegExp(firstCase.caseNo), "旧记忆案件不得混入当前结果");

const missingLocator = await requestAgentPlan("帮我撤件", "deepseek", { actorRoles: operatorRoles });
assert.equal(requestedFields(missingLocator).includes("caseNo"), true);

const suppliedLocator = await requestAgentPlan(
  `帮我撤件\n用户补充信息：案件号是 ${firstCase.caseNo}`,
  "deepseek",
  { actorRoles: operatorRoles },
);
assert.equal(requestedFields(suppliedLocator).includes("caseNo"), false, "补充案件号后不得重复追问定位信息");
assert.match(planText(suppliedLocator), new RegExp(firstCase.caseNo));

const withdrawalByName = await requestAgentPlan(
  "帮我处理撤件：先根据被保人姓名测试人员定位最近一笔尚未结案的案件，核对当前状态是否允许撤件；如允许，说明撤件影响并向我确认后再执行。",
  "deepseek",
  { actorRoles: operatorRoles },
);
assert.equal(hasBackendType(withdrawalByName, "claim_case_query_result"), true, "撤件应先按被保人姓名定位案件");
assert.equal(hasBackendType(withdrawalByName, "claim_case_inspection"), true, "撤件定位后必须核对案件状态和权限");
assert.equal(requestedFields(withdrawalByName).length > 0, true, "用户要求确认后执行时应暂停并请求确认");
assert.match(withdrawalByName.ok ? withdrawalByName.plan.reply : "", /已撤件|撤件后/);

const pagedCount = await requestAgentPlan(
  "这次查询一共有多少条案件？不要打开详情",
  "deepseek",
  {
    actorRoles: viewerRoles,
    currentPagePath: ["综合查询", "案件查询"],
    lastOperationResult: {
      type: "list_result",
      total: 27,
      returnedItemCount: 5,
      contextLimit: 5,
      truncated: true,
      items: Array.from({ length: 5 }, (_, index) => ({ itemId: `synthetic-row-${index + 1}` })),
    },
  },
);
assert.match(pagedCount.ok ? pagedCount.plan.reply : "", /27/, "分页样本数不能冒充完整命中数");
assert.doesNotMatch(pagedCount.ok ? pagedCount.plan.reply : "", /一共.{0,4}5条|共5条/, "不得把传给模型的五条样本当总数");

const mutationCompleted = await requestAgentPlan(
  `把案件 ${firstCase.caseNo} 撤件`,
  "deepseek",
  {
    actorRoles: operatorRoles,
    lastOperationResult: {
      type: "mutation_result",
      operation: "cancel_case",
      success: true,
      caseNo: firstCase.caseNo,
    },
    history: [{
      toolCalls: [{ tool: "click_button", args: { pageId: "claim_registration", actionId: "cancel_case" } }],
    }],
  },
);
assert.equal(mutationCompleted.ok ? mutationCompleted.plan.toolCalls.length : -1, 0, "成功的数据变更不能重复执行");
assert.match(mutationCompleted.ok ? mutationCompleted.plan.reply : "", /已|成功|完成/);

const forbiddenPage = await requestAgentPlan("打开受理立案页面", "deepseek", { actorRoles: viewerRoles });
assert.equal(forbiddenPage.ok ? forbiddenPage.plan.toolCalls.length : -1, 0);
assert.match(forbiddenPage.ok ? forbiddenPage.plan.reply : "", /没有访问|权限/);

const identifierBoundary = await requestAgentPlan(
  `查询案件 ${secondCase.caseNo} 的详情，只查询`,
  "deepseek",
  { actorRoles: viewerRoles },
);
assert.doesNotMatch(planText(identifierBoundary), new RegExp(`"fieldId":"policyNo","value":"${secondCase.caseNo}"`));
assert.match(planText(identifierBoundary), new RegExp(secondCase.caseNo));

console.log(JSON.stringify({
  passed: 11,
  cases: [firstCase.caseNo, secondCase.caseNo],
  scenarios: [
    "案件诊断",
    "队列汇总",
    "历史指代",
    "当前输入覆盖历史",
    "缺少定位追问",
    "补充后继续",
    "按姓名定位后撤件确认",
    "分页总数理解",
    "成功后禁止重复执行",
    "角色越权拦截",
    "案件号与保单号边界",
  ],
}, null, 2));
setAssistantBackendExecutorForTesting(null);
