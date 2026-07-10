export type AssistantPageId = "policy_query" | "claim_query";
export type AssistantFieldId =
  | "policyNo"
  | "applicantName"
  | "insuredName"
  | "insuredIdNo"
  | "policyStatus";
export type AssistantButtonId = "search" | "reset";
export type AssistantResultActionId = "view_detail" | "view_benefits" | "view_insureds";

export type AssistantDiscoveryCall =
  | { tool: "get_navigation_registry"; args: Record<string, never> }
  | { tool: "get_menu_pages"; args: { menuId: string } }
  | { tool: "get_page_registry"; args: { pageId: string } };

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
        pageId: "policy_query";
        fieldId: AssistantFieldId;
        value: string;
      };
    }
  | {
      tool: "click_button";
      args: {
        pageId: "policy_query";
        actionId: AssistantButtonId;
      };
    }
  | {
      tool: "click_list_row_action";
      args: {
        pageId: "policy_query";
        actionId: AssistantResultActionId;
        row: number;
      };
    };

export type AssistantModelToolCall = AssistantToolCall | AssistantDiscoveryCall | AssistantFinishCall;

export interface AssistantPlan {
  reply: string;
  thought?: string;
  toolCalls: AssistantToolCall[];
  recognized: string[];
  source?: "rule" | "llm";
  decision?: "continue" | "finish";
  discoverySteps?: string[];
  discoveryResults?: unknown[];
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

  if (normalized.includes("案件")) {
    return {
      reply: "我先为你打开案件查询页，后续案件能力接上后就可以继续自动执行。",
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

  const filters: Array<{ field: AssistantFieldId; value: string; label: string }> = [];

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

export function formatToolCall(call: AssistantToolCall) {
  if (call.tool === "open_page") {
    return call.args.pageId === "policy_query" ? "打开保单信息查询页" : "打开案件查询页";
  }

  if (call.tool === "set_field") {
    const labelMap: Record<AssistantFieldId, string> = {
      policyNo: "保单号",
      applicantName: "投保单位",
      insuredName: "被保人姓名",
      insuredIdNo: "被保人证件号",
      policyStatus: "保单状态",
    };
    const valueMap: Record<string, string> = {
      enabled: "启用",
      disabled: "停用",
    };
    return `填写${labelMap[call.args.fieldId]}：${valueMap[call.args.value] ?? call.args.value}`;
  }

  if (call.tool === "click_list_row_action") {
    const labels: Record<AssistantResultActionId, string> = {
      view_detail: "详细信息",
      view_benefits: "责任信息",
      view_insureds: "被保人信息",
    };
    return `点击保单列表第${call.args.row}行的${labels[call.args.actionId]}`;
  }

  return call.args.actionId === "search" ? "点击查询按钮" : "点击重置按钮";
}

export function isAssistantToolCall(value: unknown): value is AssistantToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };

  if (candidate.tool === "open_page") {
    return candidate.args?.pageId === "policy_query" || candidate.args?.pageId === "claim_query";
  }

  if (candidate.tool === "set_field") {
    return (
      candidate.args?.pageId === "policy_query" &&
      ["policyNo", "applicantName", "insuredName", "insuredIdNo", "policyStatus"].includes(
        String(candidate.args?.fieldId),
      ) &&
      typeof candidate.args?.value === "string"
    );
  }

  if (candidate.tool === "click_button") {
    return (
      candidate.args?.pageId === "policy_query" &&
      (candidate.args?.actionId === "search" || candidate.args?.actionId === "reset")
    );
  }

  if (candidate.tool === "click_list_row_action") {
    return (
      candidate.args?.pageId === "policy_query" &&
      ["view_detail", "view_benefits", "view_insureds"].includes(String(candidate.args?.actionId)) &&
      typeof candidate.args?.row === "number" &&
      Number.isInteger(candidate.args?.row) &&
      candidate.args.row > 0
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
  return isAssistantToolCall(value) || isAssistantDiscoveryCall(value) || isAssistantFinishCall(value);
}

export function isAssistantFinishCall(value: unknown): value is AssistantFinishCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };
  return candidate.tool === "finish_task" && typeof candidate.args?.reason === "string";
}

export function normalizeAssistantModelToolCall(value: unknown): AssistantModelToolCall | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { tool?: string; args?: Record<string, unknown> };

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
    const fieldAliases: Record<string, AssistantFieldId> = {
      policy_no: "policyNo",
      applicant_name: "applicantName",
      insured_name: "insuredName",
      insured_id_no: "insuredIdNo",
      policy_status: "policyStatus",
    };
    const rawField = String(candidate.args?.fieldId ?? candidate.args?.field ?? "");
    const normalizedField = fieldAliases[rawField] ?? rawField;
    const pageId = candidate.args?.pageId ?? candidate.args?.page;
    if (pageId === "policy_query" && typeof candidate.args?.value === "string") {
      const normalizedCall = {
        tool: "set_field" as const,
        args: {
          pageId: "policy_query" as const,
          fieldId: normalizedField as AssistantFieldId,
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

  return isAssistantModelToolCall(value) ? value : null;
}
