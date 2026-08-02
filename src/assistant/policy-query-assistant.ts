import {
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
  getRegisteredAction,
  getRegisteredField,
  isNavigablePage,
  type RegisteredPageId,
} from "./page-registry.ts";

export type AssistantPageId = RegisteredPageId;
export type AssistantFieldId = string;
type PolicyQueryFieldId =
  | "policyNo"
  | "applicantName"
  | "insuredName"
  | "insuredIdNo"
  | "policyStatus";
export type AssistantButtonId = string;
export type AssistantResultActionId = string;

export type AssistantDiscoveryCall =
  | { tool: "get_navigation_registry"; args: Record<string, never> }
  | { tool: "get_menu_pages"; args: { menuId: string } }
  | { tool: "get_page_registry"; args: { pageId: string } };

export type AssistantBackendCall =
  | {
      tool: "query_underwriting";
      args: { policyNo?: string; insuredName?: string; insuredIdNo?: string };
    }
  | {
      tool: "query_claim_cases";
      args: { caseNo?: string; policyNo?: string; insuredName?: string; insuredIdNo?: string };
    }
  | {
      tool: "inspect_claim_case";
      args: { caseNo: string };
    }
  | {
      tool: "summarize_claim_work_queue";
      args: Record<string, never>;
    };

export type AssistantUserInputCall = {
  tool: "ask_user";
  args: { question: string; requestedFields: string[] };
};

export type AssistantFinishCall = {
  tool: "finish_task";
  args: { reason: string };
};

export type AssistantToolCall =
  | {
      tool: "open_page";
      args: {
        pageId: AssistantPageId;
      };
    }
  | {
      tool: "set_field";
      args: {
        pageId: AssistantPageId;
        fieldId: AssistantFieldId;
        value: string;
      };
    }
  | {
      tool: "click_button";
      args: {
        pageId: AssistantPageId;
        actionId: AssistantButtonId;
      };
    }
  | {
      tool: "click_list_row_action";
      args: {
        pageId: AssistantPageId;
        actionId: AssistantResultActionId;
        row: number;
      };
    }
  | {
      tool: "click_list_item_action";
      args: {
        pageId: AssistantPageId;
        actionId: AssistantResultActionId;
        itemId: string;
      };
    };

export type AssistantModelToolCall = AssistantToolCall | AssistantDiscoveryCall | AssistantBackendCall | AssistantUserInputCall | AssistantFinishCall;

export interface AssistantPlan {
  reply: string;
  thought?: string;
  toolCalls: AssistantToolCall[];
  recognized: string[];
  source?: "rule" | "llm";
  decision?: "continue" | "finish";
  discoverySteps?: string[];
  discoveryResults?: unknown[];
  backendToolResults?: unknown[];
  userInputRequest?: AssistantUserInputCall["args"];
}

function looksLikeCompanyName(value: string) {
  return /(公司|集团|科技|咨询|制造|企业|医院|学校|中心|银行)/.test(value);
}

function detectPolicyNo(input: string) {
  return input.match(/GI\d{6,}/i)?.[0]?.toUpperCase() ?? "";
}

function detectStatus(input: string) {
  if (input.includes("停用")) return "disabled";
  if (input.includes("启用")) return "enabled";
  return "";
}

function detectIdNo(input: string) {
  if (!/(证件|身份证)/.test(input)) return "";
  return input.match(/[0-9Xx]{6,18}/)?.[0]?.toUpperCase() ?? "";
}

function detectSubject(input: string) {
  const patterns = [
    /(?:查询|查|看看|看一下|看)\s*([^，。；\s]+?)\s*(?:有哪些|有啥|有什么)?保单/,
    /(?:查询|查|看看|看一下|看)\s*([^，。；\s]+?)\s*的保单/,
    /(?:我要看|帮我查)\s*([^，。；\s]+?)\s*(?:有哪些|有啥|有什么)?保单/,
  ];

  for (const pattern of patterns) {
    const matched = input.match(pattern)?.[1]?.trim();
    if (matched) return matched;
  }

  return "";
}

export function buildAssistantPlan(userText: string): AssistantPlan | null {
  const normalized = userText.replace(/\s+/g, "");
  if (!normalized) return null;

  if (/(受理|立案|报案)/.test(normalized)) {
    return {
      reply: "我先为你打开受理立案页面。",
      recognized: ["目标页面：受理立案"],
      source: "rule",
      toolCalls: [{ tool: "open_page", args: { pageId: "claim_registration" } }],
    };
  }

  if (normalized.includes("案件")) {
    return {
      reply: "我先为你打开只读案件查询页。",
      recognized: ["目标页面：案件查询"],
      source: "rule",
      toolCalls: [
        {
          tool: "open_page",
          args: { pageId: "claim_query" },
        },
      ],
    };
  }

  const policyNo = detectPolicyNo(normalized);
  const policyStatus = detectStatus(normalized);
  const insuredIdNo = detectIdNo(normalized);
  const subject = detectSubject(normalized);

  const filters: Array<{ field: PolicyQueryFieldId; value: string; label: string }> = [];

  if (policyNo) {
    filters.push({ field: "policyNo", value: policyNo, label: `保单号 = ${policyNo}` });
  }

  if (insuredIdNo) {
    filters.push({ field: "insuredIdNo", value: insuredIdNo, label: `被保人证件号 = ${insuredIdNo}` });
  }

  if (policyStatus) {
    filters.push({
      field: "policyStatus",
      value: policyStatus,
      label: `保单状态 = ${policyStatus === "enabled" ? "启用" : "停用"}`,
    });
  }

  if (subject) {
    if (looksLikeCompanyName(subject) || normalized.includes("投保单位")) {
      filters.push({ field: "applicantName", value: subject, label: `投保单位 = ${subject}` });
    } else {
      filters.push({ field: "insuredName", value: subject, label: `被保人姓名 = ${subject}` });
    }
  }

  if (normalized.includes("重置")) {
    return {
      reply: "我来帮你清空保单查询条件。",
      recognized: ["目标页面：保单信息查询", "动作：重置查询条件"],
      source: "rule",
      toolCalls: [
        { tool: "open_page", args: { pageId: "policy_query" } },
        { tool: "click_button", args: { pageId: "policy_query", actionId: "reset" } },
      ],
    };
  }

  if (filters.length === 0) {
    return {
      reply: "我暂时没识别出明确的查询条件。你可以这样说：查张三有哪些保单、查华曜科技的保单、查停用保单。",
      recognized: ["未识别出可执行条件"],
      source: "rule",
      toolCalls: [],
    };
  }

  return {
    reply: "我来帮你打开保单查询并自动执行。",
    recognized: ["目标页面：保单信息查询", ...filters.map((item) => item.label), "动作：点击查询"],
    source: "rule",
    toolCalls: [
      { tool: "open_page", args: { pageId: "policy_query" } },
      { tool: "click_button", args: { pageId: "policy_query", actionId: "reset" } },
      ...filters.map<AssistantToolCall>((item) => ({
        tool: "set_field",
        args: {
          pageId: "policy_query",
          fieldId: item.field,
          value: item.value,
        },
      })),
      { tool: "click_button", args: { pageId: "policy_query", actionId: "search" } },
    ],
  };
}

export function formatToolInvocation(tool: string, args: Record<string, unknown>) {
  const toolLabels: Record<string, string> = {
    get_navigation_registry: "查询系统导航",
    get_menu_pages: "查询菜单页面",
    get_page_registry: "查询页面信息",
    query_underwriting: "查询承保信息",
    query_claim_cases: "查询案件信息",
    ask_user: "询问用户",
    finish_task: "完成任务",
    open_page: "打开页面",
    set_field: "填写字段",
    click_button: "执行页面操作",
    click_list_row_action: "执行列表操作",
    click_list_item_action: "执行列表对象操作",
  };
  const pageId = typeof args.pageId === "string" ? args.pageId : "";
  const fieldId = typeof args.fieldId === "string" ? args.fieldId : "";
  const actionId = typeof args.actionId === "string" ? args.actionId : "";
  const field = pageId && fieldId ? getRegisteredField(pageId, fieldId) : null;
  const action = pageId && actionId ? getRegisteredAction(pageId, actionId) : null;
  const globallyRegisteredFieldLabel = (candidate: unknown) => {
    if (typeof candidate !== "string") return String(candidate ?? "");
    for (const menu of getNavigationRegistry().menus) {
      for (const page of menu.pages) {
        const registeredField = getRegisteredField(page.pageId, candidate);
        if (registeredField) return registeredField.label;
      }
    }
    return candidate;
  };
  const valueLabel = (key: string, value: unknown) => {
    if (key === "pageId" && typeof value === "string") return getPageRegistration(value)?.label ?? value;
    if (key === "menuId" && typeof value === "string") return getMenuPages(value)?.label ?? value;
    if (key === "fieldId") return field?.label ?? globallyRegisteredFieldLabel(value);
    if (key === "actionId") return action?.label ?? String(value ?? "");
    if (key === "requestedFields" && Array.isArray(value)) return value.map(globallyRegisteredFieldLabel).join("、");
    if (key === "value" && field?.options) {
      const option = field.options.find((item) => item.value === value);
      if (option) return option.label;
    }
    if (Array.isArray(value)) return value.join("、");
    if (typeof value === "boolean") return value ? "是" : "否";
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "");
  };
  const parameterLabels: Record<string, string> = {
    menuId: "菜单",
    pageId: "页面",
    fieldId: "字段",
    actionId: "操作",
    value: "值",
    row: "行号",
    itemId: "对象标识",
    caseNo: "案件号",
    policyNo: "保单号",
    insuredName: "被保人姓名",
    insuredIdNo: "被保人证件号",
    question: "问题",
    requestedFields: "需补充信息",
    reason: "原因",
  };
  const parameters = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${parameterLabels[key] ?? "参数"}：${valueLabel(key, value)}`)
    .join("，");
  return `${toolLabels[tool] ?? "执行工具"}{${parameters}}`;
}

export function formatToolCall(call: AssistantToolCall) {
  return formatToolInvocation(call.tool, call.args);
}

export function isAssistantToolCall(value: unknown): value is AssistantToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };

  if (candidate.tool === "open_page") {
    return typeof candidate.args?.pageId === "string" && isNavigablePage(candidate.args.pageId);
  }

  if (candidate.tool === "set_field") {
    return (
      typeof candidate.args?.pageId === "string" &&
      typeof candidate.args?.fieldId === "string" &&
      getRegisteredField(candidate.args.pageId, candidate.args.fieldId) !== null &&
      typeof candidate.args?.value === "string"
    );
  }

  if (candidate.tool === "click_button") {
    return (
      typeof candidate.args?.pageId === "string" &&
      typeof candidate.args?.actionId === "string" &&
      getRegisteredAction(candidate.args.pageId, candidate.args.actionId, "page") !== null
    );
  }

  if (candidate.tool === "click_list_row_action") {
    return (
      typeof candidate.args?.pageId === "string" &&
      typeof candidate.args?.actionId === "string" &&
      getRegisteredAction(candidate.args.pageId, candidate.args.actionId, "row") !== null &&
      typeof candidate.args?.row === "number" &&
      Number.isInteger(candidate.args?.row) &&
      candidate.args.row > 0
    );
  }

  if (candidate.tool === "click_list_item_action") {
    return (
      typeof candidate.args?.pageId === "string" &&
      typeof candidate.args?.actionId === "string" &&
      getRegisteredAction(candidate.args.pageId, candidate.args.actionId, "row") !== null &&
      typeof candidate.args?.itemId === "string" &&
      candidate.args.itemId.trim().length > 0
    );
  }

  return false;
}

export function isAssistantDiscoveryCall(value: unknown): value is AssistantDiscoveryCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };
  if (candidate.tool === "get_navigation_registry") return true;
  if (candidate.tool === "get_menu_pages") return typeof candidate.args?.menuId === "string";
  if (candidate.tool === "get_page_registry") return typeof candidate.args?.pageId === "string";
  return false;
}

export function isAssistantModelToolCall(value: unknown): value is AssistantModelToolCall {
  return isAssistantToolCall(value) || isAssistantDiscoveryCall(value) || isAssistantBackendCall(value) || isAssistantUserInputCall(value) || isAssistantFinishCall(value);
}

export function isAssistantBackendCall(value: unknown): value is AssistantBackendCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };
  if (candidate.tool === "query_underwriting") {
    return [candidate.args?.policyNo, candidate.args?.insuredName, candidate.args?.insuredIdNo].some((item) => typeof item === "string" && item.trim().length > 0);
  }
  if (candidate.tool === "query_claim_cases") {
    return [candidate.args?.caseNo, candidate.args?.policyNo, candidate.args?.insuredName, candidate.args?.insuredIdNo].some((item) => typeof item === "string" && item.trim().length > 0);
  }
  if (candidate.tool === "inspect_claim_case") {
    return typeof candidate.args?.caseNo === "string" && candidate.args.caseNo.trim().length > 0;
  }
  if (candidate.tool === "summarize_claim_work_queue") return true;
  return false;
}

export function isAssistantUserInputCall(value: unknown): value is AssistantUserInputCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };
  return candidate.tool === "ask_user"
    && typeof candidate.args?.question === "string"
    && candidate.args.question.trim().length > 0
    && Array.isArray(candidate.args?.requestedFields)
    && candidate.args.requestedFields.length > 0
    && candidate.args.requestedFields.every((item) => typeof item === "string");
}

export function isAssistantFinishCall(value: unknown): value is AssistantFinishCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };
  return candidate.tool === "finish_task" && typeof candidate.args?.reason === "string";
}

export function normalizeAssistantModelToolCall(value: unknown): AssistantModelToolCall | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };

  if (candidate.tool === "query_underwriting") {
    const policyNo = typeof candidate.args?.policyNo === "string" ? candidate.args.policyNo.trim().toUpperCase() : undefined;
    if (policyNo?.startsWith("CL")) {
      return {
        tool: "query_claim_cases",
        args: { caseNo: policyNo },
      };
    }
    const normalizedCall: AssistantBackendCall = {
      tool: "query_underwriting",
      args: {
        policyNo,
        insuredName: typeof candidate.args?.insuredName === "string" ? candidate.args.insuredName : undefined,
        insuredIdNo: typeof candidate.args?.insuredIdNo === "string" ? candidate.args.insuredIdNo : undefined,
      },
    };
    return isAssistantBackendCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "query_claim_cases") {
    const normalizedCall: AssistantBackendCall = {
      tool: "query_claim_cases",
      args: {
        caseNo: typeof candidate.args?.caseNo === "string" ? candidate.args.caseNo : undefined,
        policyNo: typeof candidate.args?.policyNo === "string" ? candidate.args.policyNo : undefined,
        insuredName: typeof candidate.args?.insuredName === "string" ? candidate.args.insuredName : undefined,
        insuredIdNo: typeof candidate.args?.insuredIdNo === "string" ? candidate.args.insuredIdNo : undefined,
      },
    };
    return isAssistantBackendCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "inspect_claim_case") {
    const normalizedCall: AssistantBackendCall = {
      tool: "inspect_claim_case",
      args: { caseNo: typeof candidate.args?.caseNo === "string" ? candidate.args.caseNo.trim().toUpperCase() : "" },
    };
    return isAssistantBackendCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "summarize_claim_work_queue") {
    return { tool: "summarize_claim_work_queue", args: {} };
  }

  if (candidate.tool === "ask_user") {
    const normalizedCall: AssistantUserInputCall = {
      tool: "ask_user",
      args: {
        question: typeof candidate.args?.question === "string" ? candidate.args.question : "",
        requestedFields: Array.isArray(candidate.args?.requestedFields) ? candidate.args.requestedFields.filter((item): item is string => typeof item === "string") : [],
      },
    };
    return isAssistantUserInputCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "get_page_registry" && typeof candidate.args?.page === "string") {
    return {
      tool: "get_page_registry",
      args: { pageId: candidate.args.page },
    };
  }

  if (candidate.tool === "get_menu_pages" && typeof candidate.args?.menu === "string") {
    return {
      tool: "get_menu_pages",
      args: { menuId: candidate.args.menu },
    };
  }

  if (candidate.tool === "open_page" && typeof candidate.args?.page === "string") {
    return {
      tool: "open_page",
      args: { pageId: candidate.args.page as AssistantPageId },
    };
  }

  if (candidate.tool === "set_field") {
    const fieldAliases: Record<string, string> = {
      policy_no: "policyNo",
      applicant_name: "applicantName",
      insured_name: "insuredName",
      insured_id_no: "insuredIdNo",
      policy_status: "policyStatus",
    };
    const rawField = String(candidate.args?.fieldId ?? candidate.args?.field ?? "");
    const normalizedField = fieldAliases[rawField] ?? rawField;
    const pageId = candidate.args?.pageId ?? candidate.args?.page;
    if (typeof pageId === "string" && typeof candidate.args?.value === "string") {
      const normalizedCall = {
        tool: "set_field" as const,
        args: {
          pageId: pageId as AssistantPageId,
          fieldId: normalizedField,
          value: candidate.args.value,
        },
      };
      return isAssistantToolCall(normalizedCall) ? normalizedCall : null;
    }
  }

  if (candidate.tool === "click_button") {
    const pageId = candidate.args?.pageId ?? candidate.args?.page;
    const rawActionId = String(candidate.args?.actionId ?? candidate.args?.button ?? "");
    const actionId = ["query", "查询", "搜索"].includes(rawActionId) ? "search" : rawActionId;
    const normalizedCall = {
      tool: "click_button" as const,
      args: { pageId, actionId },
    };
    return isAssistantToolCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "click_list_row_action" || candidate.tool === "click_result_action") {
    const rawActionId = String(candidate.args?.actionId ?? candidate.args?.action ?? "");
    const actionId = rawActionId === "view_details" ? "view_detail" : rawActionId;
    const normalizedCall = {
      tool: "click_list_row_action" as const,
      args: {
        pageId: candidate.args?.pageId ?? candidate.args?.page,
        actionId,
        row: Number(candidate.args?.row),
      },
    };
    return isAssistantToolCall(normalizedCall) ? normalizedCall : null;
  }

  if (candidate.tool === "click_list_item_action") {
    const normalizedCall = {
      tool: "click_list_item_action" as const,
      args: {
        pageId: candidate.args?.pageId ?? candidate.args?.page,
        actionId: candidate.args?.actionId ?? candidate.args?.action,
        itemId: candidate.args?.itemId ?? candidate.args?.id,
      },
    };
    return isAssistantToolCall(normalizedCall) ? normalizedCall : null;
  }

  return isAssistantModelToolCall(value) ? value : null;
}
