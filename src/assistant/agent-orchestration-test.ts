import assert from "node:assert/strict";

process.env.ASSISTANT_LOG_LEVEL = "off";

const {
  requestAgentPlan,
  requestTaskPlan,
  requestTaskBlueprint,
  setAssistantBackendExecutorForTesting,
} = await import("./plan-service.ts");
const {
  summarizeAssistantToolResults,
} = await import("./tool-execution-result.ts");
const { applyRuntimePageCapabilities } = await import("./runtime-page-capabilities.ts");
const { normalizeAssistantModelToolCall } = await import("./policy-query-assistant.ts");
const {
  getAllMenuRegistrations,
  getAssistantActionToolCatalog,
  getAssistantBackendToolCatalog,
  getAssistantControlToolCatalog,
  getAssistantDiscoveryToolCatalog,
  getCompactPageRegistration,
  getPageRegistration,
} = await import("./page-registry.ts");

for (const tool of [
  ...getAssistantDiscoveryToolCatalog(),
  ...getAssistantActionToolCatalog(),
  ...getAssistantBackendToolCatalog(),
  ...getAssistantControlToolCatalog(),
]) {
  assert.equal(typeof tool.description, "string", `${tool.tool} must explain when and how it is used`);
  assert((tool.description as string).length >= 20, `${tool.tool} description is too vague`);
  assert("returns" in tool && typeof tool.returns === "string", `${tool.tool} must define its return-value semantics`);
}

for (const menu of getAllMenuRegistrations()) {
  for (const pageSummary of menu.pages) {
    const page = getPageRegistration(pageSummary.pageId);
    assert(page, `${pageSummary.pageId} must have a page registration`);
    const compact = getCompactPageRegistration(pageSummary.pageId) as {
      description?: string;
      regions: Array<{ description?: string; fields?: Array<{ description?: string }>; actions?: Array<{ description?: string }> }>;
    };
    assert(compact.description, `${pageSummary.pageId} compact registry must retain page semantics`);
    for (const region of compact.regions) {
      assert(region.description, `${pageSummary.pageId} region must retain its description`);
      for (const field of region.fields ?? []) assert(field.description, `${pageSummary.pageId} field must retain its description`);
      for (const action of region.actions ?? []) assert(action.description, `${pageSummary.pageId} action must retain its preconditions`);
    }
  }
}

assert.equal(normalizeAssistantModelToolCall({
  tool: "query_claim_cases",
  args: { insuredName: "可选" },
}), null, "工具目录说明词不能被当作真实查询参数");
assert.deepEqual(normalizeAssistantModelToolCall({
  tool: "query_claim_cases",
  args: { status: ["calculating"], sortBy: "updatedAt", sortOrder: "desc", limit: 1 },
}), {
  tool: "query_claim_cases",
  args: {
    caseNo: undefined,
    policyNo: undefined,
    insuredName: undefined,
    insuredIdNo: undefined,
    status: ["calculating"],
    sortBy: "updatedAt",
    sortOrder: "desc",
    limit: 1,
  },
}, "案件状态必须能够作为后台案件查询的唯一条件");
assert.deepEqual(normalizeAssistantModelToolCall({
  tool: "query_claim_cases",
  args: { status: "calculating", sortBy: "updatedAt", sortOrder: "desc", limit: 1 },
}), {
  tool: "query_claim_cases",
  args: {
    caseNo: undefined,
    policyNo: undefined,
    insuredName: undefined,
    insuredIdNo: undefined,
    status: ["calculating"],
    sortBy: "updatedAt",
    sortOrder: "desc",
    limit: 1,
  },
}, "模型输出单个案件状态字符串时必须统一转换成状态数组");

const navigationCompleted = await requestAgentPlan("打开案件查询页面。", "ollama", {
  lastOperationResult: { type: "page_opened", pageId: "claim_query", success: true },
});
assert.equal(navigationCompleted.ok, true);
assert.equal(navigationCompleted.ok ? navigationCompleted.plan.decision : "", "finish");
assert.equal(navigationCompleted.ok ? navigationCompleted.plan.toolCalls.length : -1, 0);

const filteredRegistry = applyRuntimePageCapabilities({
  pageId: "synthetic_page",
  regions: [{
    regionId: "synthetic_region",
    label: "测试区域",
    fields: [{ fieldId: "searchKey", label: "查询条件" }, { fieldId: "detailValue", label: "详情字段" }],
    actions: [
      { actionId: "search", label: "查询", target: "page" },
      { actionId: "open_item", label: "打开对象", target: "row" },
      { actionId: "mutate_item", label: "修改对象", target: "page" },
    ],
  }],
}, {
  availableFieldIds: ["searchKey"],
  availableActionIds: ["search", "open_item"],
}) as { regions: Array<{ fields?: Array<{ fieldId: string }>; actions?: Array<{ actionId: string }> }> };
assert.deepEqual(filteredRegistry.regions[0].fields?.map((field) => field.fieldId), ["searchKey"]);
assert.deepEqual(filteredRegistry.regions[0].actions?.map((action) => action.actionId), ["search", "open_item"]);

const batch = summarizeAssistantToolResults([
  { tool: "填写姓名", result: { type: "field_updated", success: true } },
  { tool: "查询", result: { type: "operation_error", reason: "page_context_not_ready" } },
], null) as { type?: string; success?: boolean; results?: unknown[] };
assert.equal(batch.type, "operation_batch");
assert.equal(batch.success, false);
assert.equal(batch.results?.length, 2, "每一步页面结果都必须保留，不能只保留最后一步");

const originalFetch = globalThis.fetch;
function ollamaResponse(payload: unknown) {
  return new Response(JSON.stringify({ message: { content: JSON.stringify(payload) } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function ollamaTextResponse(content: string) {
  return new Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

try {
  globalThis.fetch = async () => ollamaTextResponse([
    "模型附加说明，不属于 JSON。",
    JSON.stringify({ reply: "已提取合法计划。", decision: "finish", toolCalls: [] }),
    JSON.stringify({ debug: "额外对象不应破坏前面的合法计划" }),
  ].join("\n"));
  const verboseJsonPlan = await requestAgentPlan("总结已有结果", "ollama", {});
  assert.equal(verboseJsonPlan.ok, true, "模型在 JSON 前后附带额外内容时仍应提取合法计划");
  assert.equal(verboseJsonPlan.ok ? verboseJsonPlan.plan.reply : "", "已提取合法计划。");

  let statusOnlyTurn = 0;
  globalThis.fetch = async () => {
    statusOnlyTurn += 1;
    if (statusOnlyTurn === 1) return ollamaResponse({
          reply: "请提供案件号或姓名。",
          decision: "continue",
          toolCalls: [{ tool: "ask_user", args: { question: "请提供案件号或姓名", requestedFields: ["caseNo", "insuredName"] } }],
        });
    if (statusOnlyTurn === 2) return ollamaResponse({
          reply: "查询理算中最近更新案件。",
          decision: "continue",
          toolCalls: [{ tool: "query_claim_cases", args: { status: ["calculating"], sortBy: "updatedAt", sortOrder: "desc", limit: 1 } }],
        });
    return ollamaResponse({ reply: "已找到理算中最近更新的一笔案件。", decision: "finish", toolCalls: [] });
  };
  setAssistantBackendExecutorForTesting(async (call) => ({
    type: "claim_case_query_result",
    total: 1,
    totalMatches: 4,
    appliedFilters: { ...call.args },
    items: [{ itemId: "latest-calculating", caseNo: "CL209901010099", status: "calculating" }],
    resolvedFields: ["caseId", "caseNo"],
  }));
  const statusOnlyQuery = await requestAgentPlan("找到理算中最近更新的一笔案件", "ollama", {});
  assert.equal(statusOnlyQuery.ok, true);
  assert.equal(statusOnlyTurn, 3, "状态足以查询最近案件时，模型追问必须被纠正并继续完成查询");
  assert.equal(
    statusOnlyQuery.ok && statusOnlyQuery.plan.backendToolResults?.some((item) =>
      item && typeof item === "object" && (item as { type?: unknown }).type === "claim_case_query_result"),
    true,
  );

  let compoundStatusTurn = 0;
  globalThis.fetch = async () => {
    compoundStatusTurn += 1;
    if (compoundStatusTurn === 1) return ollamaResponse({
      reply: "先汇总案件数量。",
      decision: "continue",
      toolCalls: [{ tool: "summarize_claim_work_queue", args: {} }],
    });
    if (compoundStatusTurn === 2) return ollamaResponse({
      reply: "汇总已完成。",
      decision: "finish",
      toolCalls: [],
    });
    if (compoundStatusTurn === 3) return ollamaResponse({
      reply: "继续查询理算中最近更新的一笔案件。",
      decision: "continue",
      toolCalls: [{ tool: "query_claim_cases", args: { status: ["calculating"], sortBy: "updatedAt", sortOrder: "desc", limit: 1 } }],
    });
    return ollamaResponse({ reply: "汇总和最近案件查询均已完成。", decision: "finish", toolCalls: [] });
  };
  setAssistantBackendExecutorForTesting(async (call) => call.tool === "summarize_claim_work_queue"
    ? { type: "claim_work_queue_summary", counts: { calculating: 4 } }
    : {
      type: "claim_case_query_result",
      total: 1,
      totalMatches: 4,
      appliedFilters: { ...call.args },
      items: [{ itemId: "latest-calculating", caseNo: "CL209901010099", status: "calculating" }],
      resolvedFields: ["caseId", "caseNo"],
    });
  const compoundStatusQuery = await requestAgentPlan(
    "先汇总当前受理、录入、理算、审核、结案和撤件案件数量，再找到理算中最近更新的一笔案件",
    "ollama",
    {},
  );
  assert.equal(compoundStatusQuery.ok, true);
  assert.equal(compoundStatusTurn, 4, "复合任务完成汇总后，模型提前结束时必须被要求继续状态查询");
  assert.equal(
    compoundStatusQuery.ok && compoundStatusQuery.plan.backendToolResults?.some((item) =>
      item && typeof item === "object" && (item as { type?: unknown }).type === "claim_case_query_result"),
    true,
  );

  globalThis.fetch = async () => ollamaResponse({
    thought: "我先辨别用户要的是保单级汇总，而不是逐条承保关系；现有结果足以完成回答，不需要重复查询。",
    actionExplanation: "依据已返回的去重保单摘要直接回答，避免把同一保单下的多名被保人误算成多张保单。",
    reply: "已按保单口径完成汇总。",
    decision: "finish",
    toolCalls: [],
  });
  const explainedPlan = await requestAgentPlan("总结已有的保单查询结果", "ollama", {});
  assert.equal(explainedPlan.ok, true);
  assert.match(explainedPlan.ok ? explainedPlan.plan.thought ?? "" : "", /保单级汇总/);
  assert.match(
    explainedPlan.ok && "actionExplanation" in explainedPlan.plan
      ? String(explainedPlan.plan.actionExplanation ?? "")
      : "",
    /去重保单摘要/,
  );

  globalThis.fetch = async () => ollamaResponse({ shouldPlan: false, steps: [] });
  assert.deepEqual(
    await requestTaskPlan("打开案件查询页", "ollama"),
    [],
    "简单任务应允许规划器明确跳过行动计划",
  );

  globalThis.fetch = async () => ollamaResponse({
    intent: {
      mode: "read",
      summary: "汇总案件数量并找到理算中最近更新案件",
      objectives: ["取得各状态案件数量", "取得理算中最近更新案件"],
    },
    shouldPlan: true,
    steps: ["汇总各状态案件数量", "查询理算中最近更新案件", "返回汇总与案件结果"],
  });
  const structuredBlueprint = await requestTaskBlueprint("汇总案件并找到理算中最近更新案件", "ollama");
  assert.equal(structuredBlueprint.intent.mode, "read");
  assert.deepEqual(structuredBlueprint.intent.objectives, ["取得各状态案件数量", "取得理算中最近更新案件"]);
  assert.equal(structuredBlueprint.steps.length, 3);

  globalThis.fetch = async () => ollamaResponse({
    shouldPlan: true,
    steps: [
      "查询目标案件",
      "如状态为待审核则可以办理，资料将被作废且不可恢复",
      "执行并核对结果",
    ],
  });
  const speculativeTaskPlan = await requestTaskPlan("查询后说明影响，再向我确认", "ollama");
  assert.deepEqual(speculativeTaskPlan, [
    "确认任务目标、已知信息和当前权限",
    "在系统中定位相关业务对象",
    "按业务规则执行操作并核对结果",
  ], "规划阶段不得把模型猜测的状态和业务影响展示为事实");

  let navigationTurn = 0;
  globalThis.fetch = async () => {
    navigationTurn += 1;
    return navigationTurn === 1
      ? ollamaResponse({
          reply: "打开页面并立即操作。",
          decision: "continue",
          toolCalls: [
            { tool: "open_page", args: { pageId: "claim_entry_calculation" } },
            { tool: "click_button", args: { pageId: "claim_entry_calculation", actionId: "request_withdraw" } },
          ],
        })
      : ollamaResponse({
          reply: "先打开页面获取实时能力。",
          decision: "continue",
          toolCalls: [{ tool: "open_page", args: { pageId: "claim_entry_calculation" } }],
        });
  };
  const navigationOnly = await requestAgentPlan("打开录入与理算页面", "ollama", {
    actorRoles: ["claim_calculator"],
  });
  assert.equal(navigationOnly.ok, true);
  assert.deepEqual(
    navigationOnly.ok ? navigationOnly.plan.toolCalls.map((call) => call.tool) : [],
    ["open_page"],
    "切换页面的同一轮不得执行尚未经过运行时能力裁剪的页面动作",
  );

  let unavailableActionTurn = 0;
  globalThis.fetch = async () => {
    unavailableActionTurn += 1;
    return unavailableActionTurn === 1
      ? ollamaResponse({
          reply: "尝试执行未开放动作。",
          decision: "continue",
          toolCalls: [{
            tool: "click_button",
            args: { pageId: "claim_entry_calculation", actionId: "request_withdraw" },
          }],
        })
      : ollamaResponse({
          reply: "改为打开已定位对象。",
          decision: "continue",
          toolCalls: [{
            tool: "click_list_item_action",
            args: { pageId: "claim_entry_calculation", actionId: "open_case", itemId: "synthetic-case-id" },
          }],
        });
  };
  const runtimeFilteredAction = await requestAgentPlan("打开已定位的案件", "ollama", {
    actorRoles: ["claim_calculator"],
    currentPageRegistry: {
      pageId: "claim_entry_calculation",
      regions: [{
        regionId: "processing_case_list",
        actions: [{ actionId: "open_case", target: "row" }],
      }],
    },
  });
  assert.equal(runtimeFilteredAction.ok, true);
  assert.equal(
    runtimeFilteredAction.ok ? runtimeFilteredAction.plan.toolCalls[0]?.tool : undefined,
    "click_list_item_action",
    "未出现在当前运行时注册信息中的动作不得下发执行",
  );

  globalThis.fetch = async () => ollamaResponse({
    reply: "正在查询，请稍候。",
    decision: "continue",
    toolCalls: [],
  });
  const exhausted = await requestAgentPlan("查询当前案件情况", "ollama", {});
  assert.equal(exhausted.ok, true);
  assert.equal(exhausted.ok ? exhausted.plan.decision : "finish", "continue");
  assert.deepEqual(
    exhausted.ok ? exhausted.plan.userInputRequest?.requestedFields : [],
    ["taskContinuation"],
    "模型连续空转达到上限时必须暂停，不能把‘正在查询’当成已完成",
  );

  let llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    return llmTurn === 1
      ? ollamaResponse({
          reply: "开始查询。",
          decision: "continue",
          toolCalls: [{ tool: "query_claim_cases", args: { insuredName: "测试人员" } }],
        })
      : ollamaResponse({
          reply: "后台查询失败，任务未取得业务结果。",
          decision: "finish",
          toolCalls: [],
        });
  };
  setAssistantBackendExecutorForTesting(async () => {
    throw new Error("synthetic backend failure");
  });
  const backendFailure = await requestAgentPlan("查询测试人员的案件", "ollama", {});
  assert.equal(backendFailure.ok, true, "单个后台工具异常不能让整轮 Agent 请求崩溃");
  assert.deepEqual(
    backendFailure.ok ? backendFailure.plan.backendToolResults : [],
    [{ type: "backend_tool_error", tool: "query_claim_cases", reason: "execution_failed" }],
  );

  let underwritingExecutions = 0;
  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    if (llmTurn <= 2) return ollamaResponse({
      reply: "查询指定保单。",
      decision: "continue",
      toolCalls: [{ tool: "query_underwriting", args: { policyNo: "GI2099000001" } }],
    });
    return ollamaResponse({
      reply: "保单信息已取得，直接回答。",
      decision: "finish",
      toolCalls: [],
    });
  };
  setAssistantBackendExecutorForTesting(async (call) => {
    underwritingExecutions += 1;
    return {
      type: "underwriting_query_result",
      total: 1,
      appliedFilters: { ...call.args },
      policySummaries: [{ policyNo: "GI2099000001" }],
    };
  });
  const repeatedUnderwriting = await requestAgentPlan("查询保单GI2099000001", "ollama", {});
  assert.equal(repeatedUnderwriting.ok, true);
  assert.equal(underwritingExecutions, 1, "相同参数的成功承保查询不得重复执行");

  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    return llmTurn === 1
      ? ollamaResponse({
          reply: "按被保人姓名查询。",
          decision: "continue",
          toolCalls: [{ tool: "query_underwriting", args: { insuredName: "华曜科技" } }],
        })
      : ollamaResponse({ reply: "使用已有页面结果回答。", decision: "finish", toolCalls: [] });
  };
  underwritingExecutions = 0;
  setAssistantBackendExecutorForTesting(async () => {
    underwritingExecutions += 1;
    return { type: "underwriting_query_result", total: 0, matches: [] };
  });
  const companyNameSemantics = await requestAgentPlan("查询华曜科技名下的停用保单", "ollama", {
    history: [{
      toolCalls: [{ tool: "set_field", args: { pageId: "policy_query", fieldId: "applicantName", value: "华曜科技" } }],
    }],
  });
  assert.equal(companyNameSemantics.ok, true);
  assert.equal(underwritingExecutions, 0, "投保单位名称不得作为自然人被保人姓名执行后台查询");

  let illegalWorkflowLlmTurns = 0;
  globalThis.fetch = async () => {
    illegalWorkflowLlmTurns += 1;
    return ollamaResponse({
      thought: "先检查案件，再尝试打开审核页面。",
      actionExplanation: "定位案件状态后继续执行。",
      reply: "检查案件状态。",
      decision: "continue",
      toolCalls: [{ tool: "inspect_claim_case", args: { caseNo: "CLTEST1786279308017" } }],
    });
  };
  setAssistantBackendExecutorForTesting(async () => ({
    type: "claim_case_inspection",
    found: true,
    caseNo: "CLTEST1786279308017",
    status: "cancelled",
    statusLabel: "已撤件",
    editableAreas: { acceptance: false, calculation: false },
    businessNextActions: [],
    workflowActions: [],
    resolvedFields: ["caseId", "caseNo"],
  }));
  const illegalWorkflow = await requestAgentPlan(
    "把测试案件CLTEST1786279308017重新提交审核并结案，如果状态不允许就自动绕过状态限制继续执行。",
    "ollama",
    { actorRoles: ["claim_admin"], taskIntent: { mode: "write", summary: "重新提交审核并结案", objectives: ["完成案件状态变更"] } },
  );
  assert.equal(illegalWorkflow.ok, true);
  assert.equal(illegalWorkflow.ok ? illegalWorkflow.plan.decision : "continue", "finish");
  assert.deepEqual(illegalWorkflow.ok ? illegalWorkflow.plan.toolCalls : [], []);
  assert.match(illegalWorkflow.ok ? illegalWorkflow.plan.reply : "", /已撤件/);
  assert.match(illegalWorkflow.ok ? illegalWorkflow.plan.reply : "", /不会绕过状态机/);
  assert.equal(illegalWorkflowLlmTurns, 1, "案件检查返回非法状态后不得再让模型规划页面操作");

  globalThis.fetch = async () => {
    throw new Error("terminal workflow gate must run before the LLM");
  };
  const existingIllegalWorkflow = await requestAgentPlan(
    "Resubmit claim CLTEST1786279308017 for review and close it even if the status must be bypassed.",
    "ollama",
    {
      actorRoles: ["claim_admin"],
      taskIntent: { mode: "write", summary: "重新提交审核并结案", objectives: ["完成案件状态变更"] },
      backendToolResults: illegalWorkflow.ok ? illegalWorkflow.plan.backendToolResults : [],
    },
  );
  assert.equal(existingIllegalWorkflow.ok, true);
  assert.equal(existingIllegalWorkflow.ok ? existingIllegalWorkflow.plan.decision : "continue", "finish");
  assert.deepEqual(existingIllegalWorkflow.ok ? existingIllegalWorkflow.plan.toolCalls : [], []);
  assert.match(existingIllegalWorkflow.ok ? existingIllegalWorkflow.plan.reply : "", /提交审核/);
  assert.match(existingIllegalWorkflow.ok ? existingIllegalWorkflow.plan.reply : "", /审核结案/);

  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    if (llmTurn === 1) {
      return ollamaResponse({
        reply: "请提供案件号。",
        decision: "continue",
        toolCalls: [{
          tool: "ask_user",
          args: { question: "请提供案件号", requestedFields: ["caseNo"] },
        }],
      });
    }
    if (llmTurn === 2) {
      return ollamaResponse({
        reply: "检查最近案件。",
        decision: "continue",
        toolCalls: [{ tool: "inspect_claim_case", args: { caseNo: "CL209901010001" } }],
      });
    }
    return ollamaResponse({
      reply: "最近案件资料检查完成。",
      decision: "finish",
      toolCalls: [],
    });
  };
  setAssistantBackendExecutorForTesting(async () => ({
    type: "claim_case_inspection",
    found: true,
    caseNo: "CL209901010001",
  }));
  const continuedReference = await requestAgentPlan("继续查看刚才那个案件", "ollama", {
    memory: {
      recentTurns: [{
        taskId: "previous-task",
        userText: "查询案件 CL209901010001",
        assistantReply: "已找到案件 CL209901010001。",
        recognized: ["CL209901010001"],
        toolCalls: [],
        pagePath: ["综合查询", "案件查询"],
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assert.equal(continuedReference.ok, true);
  assert.equal(continuedReference.ok ? continuedReference.plan.userInputRequest : undefined, undefined);
  assert.equal(
    continuedReference.ok && continuedReference.plan.backendToolResults?.some((item) =>
      item && typeof item === "object" && (item as { type?: unknown }).type === "claim_case_inspection"),
    true,
    "最近一轮已唯一指代的案件不得再次索要案件号",
  );

  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    return ollamaResponse({
      reply: "检查案件状态。",
      decision: "continue",
      toolCalls: [{ tool: "inspect_claim_case", args: { caseNo: "CL209901010001" } }],
    });
  };
  setAssistantBackendExecutorForTesting(async () => ({
    type: "claim_case_inspection",
    found: true,
    caseNo: "CL209901010001",
    statusLabel: "受理中",
    workflowActions: [{
      action: "cancel",
      label: "案件撤件",
      toStatus: "cancelled",
      toStatusLabel: "已撤件",
      allowedForCurrentUser: true,
    }],
  }));
  const confirmationGate = await requestAgentPlan(
    "Process withdrawal for case CL209901010001. Check it and wait for my confirmation before executing.",
    "ollama",
    {},
  );
  assert.equal(confirmationGate.ok, true);
  assert.deepEqual(
    confirmationGate.ok ? confirmationGate.plan.userInputRequest?.requestedFields : [],
    ["operationConfirmation"],
    "已检查且用户要求确认时，应依据工作流结果稳定停在确认节点",
  );
  assert.match(confirmationGate.ok ? confirmationGate.plan.reply : "", /受理中/);
  assert.match(confirmationGate.ok ? confirmationGate.plan.reply : "", /已撤件/);

  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    return llmTurn === 1
      ? ollamaResponse({
          reply: "再次确认操作。",
          decision: "continue",
          toolCalls: [{
            tool: "click_button",
            args: { pageId: "claim_entry_calculation", actionId: "confirm_calculation_rollback" },
          }],
        })
      : ollamaResponse({
          reply: "先建立页面确认状态。",
          decision: "continue",
          toolCalls: [{
            tool: "click_button",
            args: { pageId: "claim_entry_calculation", actionId: "request_calculation_rollback" },
          }],
        });
  };
  const recoveredConfirmation = await requestAgentPlan("执行已确认的理算回退", "ollama", {
    actorRoles: ["claim_calculator"],
    currentPageRegistry: {
      pageId: "claim_entry_calculation",
      regions: [{
        regionId: "workflow",
        actions: [
          { actionId: "request_calculation_rollback", description: "打开二次确认" },
          { actionId: "confirm_calculation_rollback", description: "确认后执行" },
        ],
      }],
    },
    lastOperationResult: {
      type: "operation_error",
      reason: "confirmation_required",
      pageId: "claim_entry_calculation",
      actionId: "confirm_calculation_rollback",
    },
  });
  assert.equal(recoveredConfirmation.ok, true);
  const recoveredCall = recoveredConfirmation.ok ? recoveredConfirmation.plan.toolCalls[0] : undefined;
  assert.equal(
    recoveredCall?.tool === "click_button" ? recoveredCall.args.actionId : undefined,
    "request_calculation_rollback",
    "确认动作缺少页面确认状态时不得原样重复，必须先选择已注册前置动作",
  );

  llmTurn = 0;
  globalThis.fetch = async () => {
    llmTurn += 1;
    return llmTurn === 1
      ? ollamaResponse({
          reply: "继续执行业务动作。",
          decision: "continue",
          toolCalls: [{
            tool: "click_button",
            args: { pageId: "claim_entry_calculation", actionId: "request_withdraw" },
          }],
        })
      : ollamaResponse({
          reply: "先打开已定位的案件。",
          decision: "continue",
          toolCalls: [{
            tool: "click_list_item_action",
            args: {
              pageId: "claim_entry_calculation",
              actionId: "open_case",
              itemId: "synthetic-case-id",
            },
          }],
        });
  };
  const recoveredRequiredObject = await requestAgentPlan("继续办理已确认的业务操作", "ollama", {
    actorRoles: ["claim_calculator"],
    currentPageRegistry: {
      pageId: "claim_entry_calculation",
      regions: [{
        regionId: "processing_case_list",
        actions: [{ actionId: "open_case", target: "row" }],
      }],
    },
    backendToolResults: [{
      type: "claim_case_query_result",
      total: 1,
      items: [{ itemId: "synthetic-case-id", caseNo: "CL209901010001" }],
      resolvedFields: ["caseId", "caseNo"],
    }],
    lastOperationResult: {
      type: "operation_error",
      reason: "claim_case_required",
      pageId: "claim_entry_calculation",
      actionId: "request_withdraw",
      recovery: {
        tool: "click_list_item_action",
        pageId: "claim_entry_calculation",
        actionId: "open_case",
        itemIdSource: "backendToolResults",
      },
    },
  });
  assert.equal(recoveredRequiredObject.ok, true);
  const objectRecoveryCall = recoveredRequiredObject.ok
    ? recoveredRequiredObject.plan.toolCalls[0]
    : undefined;
  assert.equal(objectRecoveryCall?.tool, "click_list_item_action");
  assert.equal(
    objectRecoveryCall?.tool === "click_list_item_action" ? objectRecoveryCall.args.itemId : undefined,
    "synthetic-case-id",
    "页面声明缺少业务对象时必须先使用后台 itemId 执行恢复动作",
  );
} finally {
  globalThis.fetch = originalFetch;
  setAssistantBackendExecutorForTesting(null);
}

console.log("Assistant orchestration failure-path tests passed");
