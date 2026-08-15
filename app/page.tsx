"use client";

import { useEffect, useRef, useState } from "react";
import { formatToolCall, type AssistantPlan, type AssistantToolCall } from "../src/assistant/policy-query-assistant";
import { isAssistantOperationError, summarizeAssistantToolResults, type AssistantToolExecutionRecord } from "../src/assistant/tool-execution-result";
import { applyRuntimePageCapabilities, type RuntimePageCapabilities } from "../src/assistant/runtime-page-capabilities";
import type { RegisteredPageController } from "../src/assistant/page-controller";
import type { PageRegistration, RegisteredRegion } from "../src/assistant/page-registry";
import { apiFetch } from "../src/api/client";
import type { PageResult, PolicyDetailView, PolicyInsuredView, PolicyListItem } from "../src/underwriting/types";
import CalculationConfigPage from "./components/CalculationConfigPage";
import StandardFormulaManagementPage from "./components/StandardFormulaManagementPage";
import ClaimEntryCalculationPage from "./components/ClaimEntryCalculationPage";
import ClaimQueryPage from "./components/ClaimQueryPage";
import ClaimRegistrationPage from "./components/ClaimRegistrationPage";
import { APP_ROLE_LABELS, useAuth, type AppRole } from "./auth/AuthProvider";
import AuditLogPage from "./components/AuditLogPage";
import { BasicView, BenefitsView, delay, formatPolicyStatus, INSURED_PAGE_SIZE, InsuredsView, Pagination, throwIfAssistantAborted } from "./components/PolicyWorkspaceViews";

type MainTab = "policy" | "claim" | "claim_registration" | "claim_entry_calculation" | "claim_review_completion" | "calculation_config" | "standard_formulas" | "audit_logs";
type DrawerTab = "basic" | "benefits" | "insureds";
type InsuredPolicyLedgerItem = {
  id: string;
  scope: string;
  targetCode: string;
  targetName: string;
  ledgerCode: string;
  ledgerName: string;
  periodYear: number;
  currentAmount: number;
  updatedAt: string;
};
type InsuredPolicyLedgerData = {
  insuredPerson: { id: string; insuredNo: string; name: string; idNo?: string | null };
  items: InsuredPolicyLedgerItem[];
};
type LlmProvider = "ollama" | "deepseek";
type PolicyFilters = {
  policyNo: string;
  applicantName: string;
  insuredName: string;
  insuredIdNo: string;
  policyStatus: string;
};
type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  source?: string;
  systemNote?: string;
  steps?: string[];
  variant?: "tool-results" | "reasoning";
  thought?: string;
  actionExplanation?: string;
};
type AssistantContinuationContext = {
  currentPageRegistry?: unknown;
  history?: Array<{ toolCalls: AssistantToolCall[] }>;
  lastOperationResult?: unknown;
  backendToolResults?: unknown[];
  currentPlanStep?: number;
};
type AssistantVisiblePlan = {
  steps: string[];
  currentStep: number;
  completed: boolean;
};
type AssistantTaskIntent = {
  mode: "read" | "write" | "mixed" | "navigate" | "explain" | "unknown";
  summary: string;
  objectives: string[];
};
const ASSISTANT_INTENT_LABELS: Record<AssistantTaskIntent["mode"], string> = {
  read: "只读查询",
  write: "数据变更",
  mixed: "查询与变更",
  navigate: "页面导航",
  explain: "解释说明",
  unknown: "待确认",
};
type AssistantTaskResponse = {
  taskId: string;
  status: "running" | "waiting_page" | "waiting_user" | "completed" | "cancelled";
  plan: AssistantPlan | null;
  taskPlan: string[];
  taskIntent: AssistantTaskIntent;
  context?: AssistantContinuationContext;
  question?: string;
  requestedFields?: string[];
};
type AssistantMemoryTurn = {
  taskId: string;
  userText: string;
  assistantReply: string;
  recognized: string[];
  toolCalls: string[];
  pagePath: string[];
  createdAt: string;
};

const POLICY_PAGE_SIZE = 10;
const ASSISTANT_POLICY_CONTEXT_LIMIT = 5;
const ASSISTANT_LIST_CONTEXT_LIMIT = 5;
const MAX_ASSISTANT_HISTORY_ROUNDS = 8;
const MAX_ASSISTANT_BACKEND_RESULTS = 4;
const MAX_ASSISTANT_PAGE_RESUMES = 16;
const MAX_IDENTICAL_TOOL_PLANS = 2;
const LLM_PROVIDER_STORAGE_KEY = "health-agent-llm-provider";
const ASSISTANT_WELCOME_MESSAGE: AssistantMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "你好，我是智能助手。你可以直接说：查张三有哪些保单、查华曜科技的保单、查停用保单。",
};
const llmProviderOptions: Array<{ value: LlmProvider; label: string }> = [
  { value: "ollama", label: "本地模型" },
  { value: "deepseek", label: "DeepSeek" },
];
const EMPTY_POLICY_FILTERS: PolicyFilters = {
  policyNo: "",
  applicantName: "",
  insuredName: "",
  insuredIdNo: "",
  policyStatus: "",
};

const policyStatusOptions = [
  { value: "", label: "全部" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
] as const;

function userInitials(displayName: string) {
  const normalized = displayName.trim();
  if (!normalized) return "U";
  return [...normalized].slice(-2).join("").toUpperCase();
}

function pageIdToMainTab(pageId: string): MainTab | null {
  if (pageId === "policy_query" || pageId === "policy_detail") return "policy";
  if (pageId === "claim_query") return "claim";
  if (pageId === "claim_registration") return "claim_registration";
  if (pageId === "claim_entry_calculation") return "claim_entry_calculation";
  if (pageId === "claim_review_completion") return "claim_review_completion";
  if (pageId === "calculation_config") return "calculation_config";
  if (pageId === "standard_formula_management") return "standard_formulas";
  return null;
}

type RuntimeFieldOptions = Record<string, Array<{ value: string; label: string }>>;

function applyRuntimeFieldOptions(registry: unknown, runtimeOptions: RuntimeFieldOptions) {
  if (!registry || typeof registry !== "object") return registry;
  const page = registry as PageRegistration;
  if (!Array.isArray(page.regions)) return registry;

  function hydrateRegions(regions: RegisteredRegion[]): RegisteredRegion[] {
    return regions.map((region) => ({
      ...region,
      fields: region.fields?.map((field) => ({
        ...field,
        options: runtimeOptions[`${page.pageId}.${field.fieldId}`] ?? field.options,
      })),
      children: region.children ? hydrateRegions(region.children) : undefined,
    }));
  }

  return { ...page, regions: hydrateRegions(page.regions) };
}

function buildInsuredListContext(
  data: PageResult<PolicyInsuredView>,
  selectedOption?: { value: string; label: string },
) {
  const items = data.items.slice(0, ASSISTANT_LIST_CONTEXT_LIMIT);
  return {
    type: "list_result",
    pageId: "policy_detail",
    regionId: "policy_insured_list",
    filters: selectedOption ? [{ fieldId: "coveragePlanId", ...selectedOption }] : [],
    total: data.total,
    page: data.page,
    returnedItemCount: items.length,
    contextLimit: ASSISTANT_LIST_CONTEXT_LIMIT,
    truncated: data.total > items.length,
    items: items.map((item) => ({
      policyInsuredId: item.id,
      insuredPersonId: item.insuredPerson.id,
      insuredNo: item.insuredPerson.insuredNo,
      name: item.insuredPerson.name,
      idType: item.insuredPerson.idType,
      idNo: item.insuredPerson.idNo,
      phone: item.insuredPerson.phone,
      coveragePlanId: item.coveragePlanId,
      coveragePlanCode: item.coveragePlan?.planCode,
      coveragePlanName: item.coveragePlan?.planName,
    })),
  };
}

export default function Page() {
  const { user, hasAnyRole, logout } = useAuth();
  const [mainTab, setMainTab] = useState<MainTab>("policy");
  const [openTabs, setOpenTabs] = useState<MainTab[]>(["policy"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [claimMenuOpen, setClaimMenuOpen] = useState(false);
  const [configMenuOpen, setConfigMenuOpen] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const topNavRef = useRef<HTMLElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [filters, setFilters] = useState<PolicyFilters>(EMPTY_POLICY_FILTERS);
  const [policies, setPolicies] = useState<PolicyListItem[]>([]);
  const [policyTotal, setPolicyTotal] = useState(0);
  const [policyPage, setPolicyPage] = useState(1);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("basic");
  const [drawerData, setDrawerData] = useState<PolicyDetailView | null>(null);
  const [insureds, setInsureds] = useState<PolicyInsuredView[]>([]);
  const [insuredTotal, setInsuredTotal] = useState(0);
  const [insuredPage, setInsuredPage] = useState(1);
  const [insuredPlanId, setInsuredPlanId] = useState("");
  const [insuredLedgerOpen, setInsuredLedgerOpen] = useState(false);
  const [insuredLedgerLoading, setInsuredLedgerLoading] = useState(false);
  const [insuredLedgerError, setInsuredLedgerError] = useState("");
  const [insuredLedgerData, setInsuredLedgerData] = useState<InsuredPolicyLedgerData | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("deepseek");
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantStopping, setAssistantStopping] = useState(false);
  const [assistantProgress, setAssistantProgress] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([ASSISTANT_WELCOME_MESSAGE]);
  const [assistantTaskPlan, setAssistantTaskPlan] = useState<AssistantVisiblePlan | null>(null);
  const [assistantTaskIntent, setAssistantTaskIntent] = useState<AssistantTaskIntent | null>(null);
  const [assistantPlanExpanded, setAssistantPlanExpanded] = useState(false);
  const [assistantMemoryLoading, setAssistantMemoryLoading] = useState(false);
  const [assistantMemoryClearing, setAssistantMemoryClearing] = useState(false);
  const [assistantRecognized, setAssistantRecognized] = useState<string[]>([]);
  const [assistantPendingTask, setAssistantPendingTask] = useState<{
    taskId: string;
    question: string;
    requestedFields: string[];
  } | null>(null);
  const selectRef = useRef<HTMLDivElement | null>(null);
  const modelSelectRef = useRef<HTMLDivElement | null>(null);
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<PolicyFilters>(EMPTY_POLICY_FILTERS);
  const policiesRef = useRef<PolicyListItem[]>([]);
  const drawerDataRef = useRef<PolicyDetailView | null>(null);
  const insuredPlanIdRef = useRef("");
  const calculationConfigControllerRef = useRef<RegisteredPageController | null>(null);
  const standardFormulaControllerRef = useRef<RegisteredPageController | null>(null);
  const claimQueryControllerRef = useRef<RegisteredPageController | null>(null);
  const claimRegistrationControllerRef = useRef<RegisteredPageController | null>(null);
  const claimEntryCalculationControllerRef = useRef<RegisteredPageController | null>(null);
  const claimReviewCompletionControllerRef = useRef<RegisteredPageController | null>(null);
  const assistantAbortControllerRef = useRef<AbortController | null>(null);
  const assistantTaskIdRef = useRef<string | null>(null);
  const assistantPageRegistryCacheRef = useRef(new Map<string, unknown>());

  function getRegisteredPageController(pageId: string) {
    if (pageId === "calculation_config") return calculationConfigControllerRef.current;
    if (pageId === "standard_formula_management") return standardFormulaControllerRef.current;
    if (pageId === "claim_query") return claimQueryControllerRef.current;
    if (pageId === "claim_registration") return claimRegistrationControllerRef.current;
    if (pageId === "claim_entry_calculation") return claimEntryCalculationControllerRef.current;
    if (pageId === "claim_review_completion") return claimReviewCompletionControllerRef.current;
    return null;
  }

  function runtimeCapabilitiesFor(pageId: string) {
    if (pageId === "policy_query") {
      return {
        availableActionIds: policiesRef.current.length
          ? ["search", "reset", "view_detail", "view_benefits", "view_insureds"]
          : ["search", "reset"],
        availableFieldIds: Object.keys(EMPTY_POLICY_FILTERS),
      } satisfies RuntimePageCapabilities;
    }
    if (pageId === "policy_detail") {
      return drawerDataRef.current
        ? {
            availableActionIds: ["view_detail", "view_benefits", "view_insureds"],
            availableFieldIds: ["coveragePlanId"],
          } satisfies RuntimePageCapabilities
        : { availableActionIds: [], availableFieldIds: [] } satisfies RuntimePageCapabilities;
    }
    return getRegisteredPageController(pageId)?.getRuntimeCapabilities?.();
  }

  function updateInsuredPlanId(value: string) {
    insuredPlanIdRef.current = value;
    setInsuredPlanId(value);
  }

  function openMainTab(tab: MainTab) {
    const requiredRoles: Record<MainTab, AppRole[]> = {
      policy: ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer"],
      claim: ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer"],
      claim_registration: ["claim_acceptor"],
      claim_entry_calculation: ["claim_calculator"],
      claim_review_completion: ["claim_reviewer"],
      calculation_config: ["claim_admin"],
      standard_formulas: ["claim_admin"],
      audit_logs: ["claim_admin"],
    };
    if (!hasAnyRole(...requiredRoles[tab])) return;
    setOpenTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
    setMainTab(tab);
  }

  function closeMainTab(tab: MainTab) {
    setOpenTabs((tabs) => {
      const nextTabs = tabs.filter((item) => item !== tab);
      if (mainTab === tab) {
        setMainTab(nextTabs[nextTabs.length - 1] ?? "policy");
      }
      return nextTabs;
    });

    if (tab === "policy") {
      setDrawerOpen(false);
    }
  }

  useEffect(() => {
    void loadPolicies(filters);
  }, []);

  useEffect(() => {
    const savedProvider = window.localStorage.getItem(LLM_PROVIDER_STORAGE_KEY);
    if (savedProvider === "ollama" || savedProvider === "deepseek") setLlmProvider(savedProvider);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    setAssistantMemoryLoading(true);
    void apiFetch("/api/assistant/memory?limit=20", { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("assistant_memory_load_failed");
        const payload = await response.json() as { turns?: AssistantMemoryTurn[] };
        const historyMessages = (payload.turns ?? []).flatMap<AssistantMessage>((turn) => [
          {
            id: `memory-user-${turn.taskId}`,
            role: "user",
            content: turn.userText,
          },
          {
            id: `memory-assistant-${turn.taskId}`,
            role: "assistant",
            content: turn.assistantReply,
            source: "历史记忆",
            steps: turn.toolCalls,
          },
        ]);
        setAssistantMessages((current) => current.length === 1 && current[0]?.id === ASSISTANT_WELCOME_MESSAGE.id
          ? [ASSISTANT_WELCOME_MESSAGE, ...historyMessages]
          : current);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("assistant memory load failed");
        }
      })
      .finally(() => setAssistantMemoryLoading(false));
    return () => abortController.abort();
  }, [user.id]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!assistantOpen) return;
    const messages = assistantMessagesRef.current;
    if (messages) messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  }, [assistantOpen, assistantMessages, assistantProgress, assistantRecognized]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (topNavRef.current && !topNavRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setClaimMenuOpen(false);
        setConfigMenuOpen(false);
        setSystemMenuOpen(false);
      }
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setStatusOpen(false);
      }
      if (modelSelectRef.current && !modelSelectRef.current.contains(event.target as Node)) {
        setModelSelectOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setClaimMenuOpen(false);
      setConfigMenuOpen(false);
      setSystemMenuOpen(false);
      setUserMenuOpen(false);
    }
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function loadPolicies(nextFilters: PolicyFilters, page = 1) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("page", String(page));
    params.set("pageSize", String(POLICY_PAGE_SIZE));
    const response = await apiFetch(`/api/policies?${params.toString()}`);
    const data: PageResult<PolicyListItem> = await response.json();
    policiesRef.current = data.items;
    setPolicies(data.items);
    setPolicyTotal(data.total);
    setPolicyPage(data.page);
    setActivePolicyId(null);
    setDrawerOpen(false);
    setDrawerData(null);
    drawerDataRef.current = null;
    setInsureds([]);
    setInsuredTotal(0);
    updateInsuredPlanId("");
    return data;
  }

  async function loadPolicyInsureds(policyId: string, page = 1, coveragePlanId = insuredPlanIdRef.current) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(INSURED_PAGE_SIZE) });
    if (coveragePlanId) params.set("coveragePlanId", coveragePlanId);
    const response = await apiFetch(`/api/policies/${policyId}/insureds?${params.toString()}`);
    const data: PageResult<PolicyInsuredView> = await response.json();
    setInsureds(data.items);
    setInsuredTotal(data.total);
    setInsuredPage(data.page);
    return data;
  }

  async function openInsuredLedger(item: PolicyInsuredView) {
    if (!drawerData) return;
    setInsuredLedgerOpen(true);
    setInsuredLedgerLoading(true);
    setInsuredLedgerError("");
    setInsuredLedgerData({ insuredPerson: item.insuredPerson, items: [] });
    try {
      const params = new URLSearchParams({ policyId: drawerData.policy.id, insuredPersonId: item.insuredPerson.id });
      const response = await apiFetch(`/api/automatic-calculation/ledgers?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as InsuredPolicyLedgerData & { message?: string };
      if (!response.ok) throw new Error(result.message ?? "insured_ledger_load_failed");
      setInsuredLedgerData(result);
    } catch {
      setInsuredLedgerError("台账加载失败，请稍后重试。");
    } finally {
      setInsuredLedgerLoading(false);
    }
  }

  async function openPolicyDrawer(policyId: string, tab: DrawerTab) {
    setActivePolicyId(policyId);
    setDrawerTab(tab);
    setInsuredPage(1);
    updateInsuredPlanId("");
    const response = await apiFetch(`/api/policies/${policyId}/full-view`);
    const data: PolicyDetailView = await response.json();
    drawerDataRef.current = data;
    setDrawerData(data);
    setInsureds([]);
    setInsuredTotal(data.insuredCount);
    setDrawerOpen(true);
    const insuredResult = tab === "insureds" ? await loadPolicyInsureds(policyId, 1, "") : null;
    return { detail: data, insuredResult };
  }

  async function loadAssistantPageRegistry(pageId: string, signal?: AbortSignal) {
    if (assistantPageRegistryCacheRef.current.has(pageId)) {
      return assistantPageRegistryCacheRef.current.get(pageId);
    }
    const response = await apiFetch(`/api/assistant/registry?resource=page&view=compact&pageId=${encodeURIComponent(pageId)}`, { signal });
    const data = (await response.json()) as { page?: unknown };
    assistantPageRegistryCacheRef.current.set(pageId, data.page);
    return data.page;
  }

  function appendAssistantMessage(message: AssistantMessage) {
    setAssistantMessages((current) => [...current, message]);
  }

  async function executeAssistantTools(
    toolCalls: AssistantToolCall[],
    initialTab: MainTab = mainTab,
    executionOpenTabs = new Set(openTabs),
    previousOperationResult: unknown = null,
    operationNamespace?: string,
    signal?: AbortSignal,
  ) {
    throwIfAssistantAborted(signal);
    const nextFilters: PolicyFilters = { ...filtersRef.current };
    let currentPolicies = policiesRef.current;
    let executionTab = initialTab;
    let lastOperationResult: unknown = previousOperationResult;
    const toolResults: AssistantToolExecutionRecord[] = [];
    let openedPageId: string | null = null;
    const steps: string[] = [];
    const fieldExecutors: Record<string, (value: string) => Promise<unknown>> = {};
    (Object.keys(EMPTY_POLICY_FILTERS) as Array<keyof PolicyFilters>).forEach((fieldId) => {
      fieldExecutors[`policy_query.${fieldId}`] = async (value) => {
        nextFilters[fieldId] = value;
        filtersRef.current = { ...nextFilters };
        setFilters({ ...nextFilters });
        return { type: "field_updated", pageId: "policy_query", fieldId, value };
      };
    });
    fieldExecutors["policy_detail.coveragePlanId"] = async (value) => {
      const detail = drawerDataRef.current;
      if (!detail) return { type: "operation_error", reason: "page_context_not_ready" };
      const selectedPlan = detail.coveragePlans.find((plan) => plan.id === value);
      if (value && !selectedPlan) return { type: "operation_error", reason: "invalid_field_option", value };

      updateInsuredPlanId(value);
      setDrawerTab("insureds");
      const result = await loadPolicyInsureds(detail.policy.id, 1, value);
      return buildInsuredListContext(result, {
        value,
        label: selectedPlan ? `${selectedPlan.planCode} / ${selectedPlan.planName}` : "全部保障计划",
      });
    };

    const pageActionExecutors: Record<string, () => Promise<unknown>> = {
      "policy_query.reset": async () => {
        Object.assign(nextFilters, EMPTY_POLICY_FILTERS);
        filtersRef.current = { ...nextFilters };
        setFilters({ ...nextFilters });
        setPolicyPage(1);
        setActivePolicyId(null);
        setDrawerOpen(false);
        setDrawerData(null);
        drawerDataRef.current = null;
        return { type: "page_action", pageId: "policy_query", actionId: "reset" };
      },
      "policy_query.search": async () => {
        setFilters({ ...nextFilters });
        const policyResult = await loadPolicies(nextFilters);
        currentPolicies = policyResult.items;
        const contextPolicies = currentPolicies.slice(0, ASSISTANT_POLICY_CONTEXT_LIMIT);
        const policiesWithMatchedInsureds = await Promise.all(contextPolicies.map(async (policy) => {
          const params = new URLSearchParams({ page: "1", pageSize: String(ASSISTANT_LIST_CONTEXT_LIMIT) });
          if (nextFilters.insuredName) params.set("insuredName", nextFilters.insuredName);
          if (nextFilters.insuredIdNo) params.set("insuredIdNo", nextFilters.insuredIdNo);
          const matchedInsureds = nextFilters.insuredName || nextFilters.insuredIdNo
            ? await apiFetch(`/api/policies/${encodeURIComponent(policy.id)}/insureds?${params.toString()}`).then((response) => response.json() as Promise<PageResult<PolicyInsuredView>>)
            : null;
          return {
            policyId: policy.id,
            policyNo: policy.policyNo,
            policyName: policy.policyName,
            applicantName: policy.applicantName,
            policyStatus: policy.policyStatus,
            effectiveDate: policy.effectiveDate,
            expiryDate: policy.expiryDate,
            insuredCount: policy.insuredCount,
            matchedInsuredCount: matchedInsureds?.total ?? undefined,
            matchedInsureds: matchedInsureds?.items.map((item) => ({
              policyInsuredId: item.id,
              insuredPersonId: item.insuredPerson.id,
              insuredNo: item.insuredPerson.insuredNo,
              name: item.insuredPerson.name,
              idType: item.insuredPerson.idType,
              idNo: item.insuredPerson.idNo,
              phone: item.insuredPerson.phone,
            })),
          };
        }));
        return {
          type: "policy_search",
          matchedPolicyCount: policyResult.total,
          resultPage: policyResult.page,
          returnedPolicyCount: contextPolicies.length,
          policyListContextLimit: ASSISTANT_POLICY_CONTEXT_LIMIT,
          policyListTruncated: policyResult.total > contextPolicies.length,
          policies: policiesWithMatchedInsureds,
        };
      },
      "policy_detail.view_detail": async () => {
        const detail = drawerDataRef.current;
        if (!detail) return { type: "operation_error", reason: "page_context_not_ready" };
        setDrawerTab("basic");
        return {
          type: "detail_view",
          pageId: "policy_detail",
          actionId: "view_detail",
          policyNo: detail.policy.policyNo,
          policyStatus: detail.policy.policyStatus,
          effectiveDate: detail.policy.effectiveDate,
          expiryDate: detail.policy.expiryDate,
          coveragePlanCount: detail.coveragePlans.length,
          productCount: detail.products.length,
          insuredCount: detail.insuredCount,
        };
      },
      "policy_detail.view_benefits": async () => {
        const detail = drawerDataRef.current;
        if (!detail) return { type: "operation_error", reason: "page_context_not_ready" };
        setDrawerTab("benefits");
        return {
          type: "detail_view",
          pageId: "policy_detail",
          actionId: "view_benefits",
          coveragePlanCount: detail.coveragePlans.length,
          productCount: detail.products.length,
          benefitCount: detail.products.reduce((sum, product) => sum + product.benefits.length, 0),
        };
      },
      "policy_detail.view_insureds": async () => {
        const detail = drawerDataRef.current;
        if (!detail) return { type: "operation_error", reason: "page_context_not_ready" };
        setDrawerTab("insureds");
        const selectedPlanId = insuredPlanIdRef.current;
        const selectedPlan = detail.coveragePlans.find((plan) => plan.id === selectedPlanId);
        const result = await loadPolicyInsureds(detail.policy.id, 1, selectedPlanId);
        return buildInsuredListContext(result, selectedPlan ? {
          value: selectedPlan.id,
          label: `${selectedPlan.planCode} / ${selectedPlan.planName}`,
        } : undefined);
      },
    };

    for (const [toolIndex, toolCall] of toolCalls.entries()) {
      throwIfAssistantAborted(signal);
      const actionOptions = operationNamespace
        ? { operationId: `${operationNamespace}:${toolIndex}` }
        : undefined;
      try {
      // 页面动作有页面前置条件：即使 LLM 省略了 open_page，也不能在错误页面上执行。
      const requiredTab = toolCall.tool === "open_page" ? null : pageIdToMainTab(toolCall.args.pageId);
      if (requiredTab && (executionTab !== requiredTab || !executionOpenTabs.has(requiredTab))) {
        openMainTab(requiredTab);
        executionTab = requiredTab;
        executionOpenTabs.add(requiredTab);
        steps.push(formatToolCall({ tool: "open_page", args: { pageId: toolCall.args.pageId } }));
        await delay(120);
        throwIfAssistantAborted(signal);
      }

      if (toolCall.tool === "open_page") {
        const targetTab = pageIdToMainTab(toolCall.args.pageId) ?? "claim";
        steps.push(formatToolCall(toolCall));

        // 显式 open_page 始终按“重新打开”处理，确保页面回到初始状态。
        setOpenTabs((tabs) => tabs.filter((tab) => tab !== targetTab));
        executionOpenTabs.delete(targetTab);

        if (targetTab === "policy") {
          const initialFilters = { ...EMPTY_POLICY_FILTERS };
          Object.assign(nextFilters, initialFilters);
          filtersRef.current = initialFilters;
          setFilters(initialFilters);
          setPolicyPage(1);
          setActivePolicyId(null);
          setDrawerOpen(false);
          setDrawerData(null);
          drawerDataRef.current = null;
          setInsureds([]);
          setInsuredTotal(0);
          setInsuredPage(1);
        }
        if (targetTab === "calculation_config") {
          await getRegisteredPageController("calculation_config")?.executeAction("reset");
        }
        if (targetTab === "standard_formulas") {
          await getRegisteredPageController("standard_formula_management")?.executeAction("reset");
        }
        if (targetTab === "claim") {
          await getRegisteredPageController("claim_query")?.executeAction("reset");
        }
        if (targetTab === "claim_registration") {
          await getRegisteredPageController("claim_registration")?.executeAction("reset");
        }
        if (targetTab === "claim_entry_calculation") {
          await getRegisteredPageController("claim_entry_calculation")?.executeAction("reset");
        }
        if (targetTab === "claim_review_completion") {
          await getRegisteredPageController("claim_review_completion")?.executeAction("reset");
        }

        await delay(120);
        throwIfAssistantAborted(signal);
        openMainTab(targetTab);
        executionTab = targetTab;
        executionOpenTabs.add(targetTab);
        openedPageId = toolCall.args.pageId;
        if (targetTab === "policy") await loadPolicies({ ...EMPTY_POLICY_FILTERS });
        lastOperationResult = { type: "page_opened", pageId: toolCall.args.pageId, success: true };
        toolResults.push({ tool: formatToolCall(toolCall), result: lastOperationResult });
        continue;
      }

      steps.push(formatToolCall(toolCall));

      if (toolCall.tool === "set_field") {
        const executor = fieldExecutors[`${toolCall.args.pageId}.${toolCall.args.fieldId}`];
        const controller = getRegisteredPageController(toolCall.args.pageId);
        const operationResult = executor
          ? await executor(toolCall.args.value)
          : controller
            ? await controller.setField(toolCall.args.fieldId, toolCall.args.value)
            : { type: "operation_error", reason: "field_executor_not_bound", pageId: toolCall.args.pageId, fieldId: toolCall.args.fieldId };
        lastOperationResult = operationResult;
        toolResults.push({ tool: formatToolCall(toolCall), result: operationResult });
        await delay(180);
        throwIfAssistantAborted(signal);
        if (isAssistantOperationError(operationResult)) break;
        continue;
      }

      if (toolCall.tool === "click_button") {
        const executor = pageActionExecutors[`${toolCall.args.pageId}.${toolCall.args.actionId}`];
        const controller = getRegisteredPageController(toolCall.args.pageId);
        const operationResult = executor
          ? await executor()
          : controller
            ? await controller.executeAction(toolCall.args.actionId, actionOptions)
            : { type: "operation_error", reason: "action_executor_not_bound", pageId: toolCall.args.pageId, actionId: toolCall.args.actionId };
        lastOperationResult = operationResult;
        toolResults.push({ tool: formatToolCall(toolCall), result: operationResult });
        await delay(220);
        throwIfAssistantAborted(signal);
        if (isAssistantOperationError(operationResult)) break;
        continue;
      }

      if (toolCall.tool === "click_list_row_action") {
        const controller = getRegisteredPageController(toolCall.args.pageId);
        if (controller) {
          lastOperationResult = await controller.executeRowAction(toolCall.args.actionId, toolCall.args.row, actionOptions);
          toolResults.push({ tool: formatToolCall(toolCall), result: lastOperationResult });
          await delay(220);
          throwIfAssistantAborted(signal);
          if (isAssistantOperationError(lastOperationResult)) break;
          continue;
        }
        const selectedPolicy = currentPolicies[toolCall.args.row - 1];
        if (selectedPolicy) {
          const drawerTabMap = {
            view_detail: "basic",
            view_benefits: "benefits",
            view_insureds: "insureds",
          } as const;
          const targetTab = drawerTabMap[toolCall.args.actionId as keyof typeof drawerTabMap];
          if (!targetTab) {
            lastOperationResult = { type: "operation_error", reason: "row_action_executor_not_bound", actionId: toolCall.args.actionId };
          } else {
            const { detail, insuredResult } = await openPolicyDrawer(selectedPolicy.id, targetTab);
            openedPageId = "policy_detail";
            lastOperationResult = {
              type: "open_policy_drawer",
              policyId: selectedPolicy.id,
              tab: toolCall.args.actionId,
              policyNo: detail.policy.policyNo,
              policyName: detail.policy.policyName,
              coveragePlanCount: detail.coveragePlans.length,
              coveragePlans: detail.coveragePlans.map((plan) => ({ id: plan.id, code: plan.planCode, name: plan.planName })),
              insuredCount: detail.insuredCount,
              listResult: insuredResult ? buildInsuredListContext(insuredResult) : undefined,
            };
          }
        } else {
          lastOperationResult = {
            type: "operation_error",
            reason: "row_not_found",
            pageId: toolCall.args.pageId,
            row: toolCall.args.row,
          };
        }
        toolResults.push({ tool: formatToolCall(toolCall), result: lastOperationResult });
        await delay(220);
        throwIfAssistantAborted(signal);
        if (isAssistantOperationError(lastOperationResult)) break;
      }

      if (toolCall.tool === "click_list_item_action") {
        const controller = getRegisteredPageController(toolCall.args.pageId);
        if (controller?.executeItemAction) {
          lastOperationResult = await controller.executeItemAction(toolCall.args.actionId, toolCall.args.itemId, actionOptions);
        } else if (toolCall.args.pageId === "policy_query") {
          const selectedPolicy = currentPolicies.find((policy) => policy.id === toolCall.args.itemId);
          const drawerTabMap = {
            view_detail: "basic",
            view_benefits: "benefits",
            view_insureds: "insureds",
          } as const;
          const targetTab = drawerTabMap[toolCall.args.actionId as keyof typeof drawerTabMap];
          if (!targetTab) {
            lastOperationResult = {
              type: "operation_error",
              reason: "item_action_executor_not_bound",
              pageId: toolCall.args.pageId,
              actionId: toolCall.args.actionId,
              itemId: toolCall.args.itemId,
            };
          } else if (!selectedPolicy) {
            lastOperationResult = {
              type: "operation_error",
              reason: "item_not_found",
              pageId: toolCall.args.pageId,
              itemId: toolCall.args.itemId,
            };
          } else {
            const { detail, insuredResult } = await openPolicyDrawer(selectedPolicy.id, targetTab);
            openedPageId = "policy_detail";
            lastOperationResult = {
              type: "open_policy_drawer",
              policyId: selectedPolicy.id,
              tab: toolCall.args.actionId,
              policyNo: detail.policy.policyNo,
              policyName: detail.policy.policyName,
              coveragePlanCount: detail.coveragePlans.length,
              coveragePlans: detail.coveragePlans.map((plan) => ({ id: plan.id, code: plan.planCode, name: plan.planName })),
              insuredCount: detail.insuredCount,
              listResult: insuredResult ? buildInsuredListContext(insuredResult) : undefined,
            };
          }
        } else {
          lastOperationResult = {
            type: "operation_error",
            reason: "item_action_executor_not_bound",
            pageId: toolCall.args.pageId,
            actionId: toolCall.args.actionId,
            itemId: toolCall.args.itemId,
          };
        }
        toolResults.push({ tool: formatToolCall(toolCall), result: lastOperationResult });
        await delay(220);
        throwIfAssistantAborted(signal);
        if (isAssistantOperationError(lastOperationResult)) break;
      }
      } catch {
        throwIfAssistantAborted(signal);
        lastOperationResult = {
          type: "operation_error",
          reason: "tool_execution_failed",
          tool: formatToolCall(toolCall),
        };
        toolResults.push({ tool: formatToolCall(toolCall), result: lastOperationResult });
        break;
      }
    }

    const runtimeOptionProviders: Record<string, () => Array<{ value: string; label: string }>> = {
      "policy_detail.coveragePlanId": () => {
        const detail = drawerDataRef.current;
        return detail ? [
          { value: "", label: "全部保障计划" },
          ...detail.coveragePlans.map((plan) => ({ value: plan.id, label: `${plan.planCode} / ${plan.planName}` })),
        ] : [];
      },
    };
    const runtimeFieldOptions = Object.fromEntries(
      Object.entries(runtimeOptionProviders).map(([fieldKey, provider]) => [fieldKey, provider()]),
    ) satisfies RuntimeFieldOptions;
    Object.assign(runtimeFieldOptions, calculationConfigControllerRef.current?.getRuntimeFieldOptions() ?? {});
    Object.assign(runtimeFieldOptions, standardFormulaControllerRef.current?.getRuntimeFieldOptions() ?? {});
    Object.assign(runtimeFieldOptions, claimQueryControllerRef.current?.getRuntimeFieldOptions() ?? {});
    Object.assign(runtimeFieldOptions, claimRegistrationControllerRef.current?.getRuntimeFieldOptions() ?? {});
    Object.assign(runtimeFieldOptions, claimEntryCalculationControllerRef.current?.getRuntimeFieldOptions() ?? {});
    Object.assign(runtimeFieldOptions, claimReviewCompletionControllerRef.current?.getRuntimeFieldOptions() ?? {});
    const runtimePageCapabilities = Object.fromEntries(
      [
        "policy_query",
        "policy_detail",
        "calculation_config",
        "standard_formula_management",
        "claim_query",
        "claim_registration",
        "claim_entry_calculation",
        "claim_review_completion",
      ].flatMap((pageId) => {
        const capabilities = runtimeCapabilitiesFor(pageId);
        return capabilities ? [[pageId, capabilities] as const] : [];
      }),
    ) satisfies Record<string, RuntimePageCapabilities>;

    return {
      steps,
      currentPage: executionTab,
      openTabs: executionOpenTabs,
      openedPageId,
      runtimeFieldOptions,
      runtimePageCapabilities,
      toolResults,
      executionResult: summarizeAssistantToolResults(toolResults, lastOperationResult ?? {
        executedActions: toolCalls.map(formatToolCall),
      }),
    };
  }

  async function handleAssistantSubmit() {
    const text = assistantInput.trim();
    if (!text || assistantBusy) return;
    const pendingTask = assistantPendingTask;
    const selectedProvider = llmProvider;
    const selectedProviderLabel = llmProviderOptions.find((option) => option.value === selectedProvider)?.label ?? selectedProvider;
    const abortController = new AbortController();
    assistantAbortControllerRef.current = abortController;

    appendAssistantMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    });
    setAssistantInput("");
    setAssistantPendingTask(null);
    if (!pendingTask) {
      setAssistantTaskPlan(null);
      setAssistantTaskIntent(null);
      setAssistantPlanExpanded(false);
    }

    setAssistantBusy(true);
    setAssistantStopping(false);
    setAssistantProgress("正在等待 LLM 生成本轮计划。");

    try {
      let currentPage: MainTab = mainTab;
      let currentOpenTabs = new Set(openTabs);
      let displayedToolEventSequence = 0;
      let previousToolPlanSignature = "";
      let identicalToolPlanCount = 0;
      let lastExecutedPlan: AssistantPlan | null = null;
      let lastExecutionResult: {
        currentPage: string;
        executionResult: unknown;
        runtimeFieldOptions: RuntimeFieldOptions;
        steps: string[];
      } | null = null;
      const initialPageId = mainTab === "policy"
        ? "policy_query"
        : mainTab === "calculation_config"
          ? "calculation_config"
          : mainTab === "standard_formulas"
            ? "standard_formula_management"
          : mainTab === "claim_registration"
            ? "claim_registration"
            : mainTab === "claim_entry_calculation"
              ? "claim_entry_calculation"
              : mainTab === "claim_review_completion"
                ? "claim_review_completion"
                : "claim_query";

      async function parseTaskResponse(response: Response) {
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as
            | { detail?: string; message?: string }
            | null;
          throw new Error(errorPayload?.detail ?? errorPayload?.message ?? "assistant_task_failed");
        }
        return response.json() as Promise<AssistantTaskResponse>;
      }

      function appendToolResults(lines: string[]) {
        if (!lines.length) return;
        displayedToolEventSequence += 1;
        setAssistantMessages((current) => {
          const last = current.at(-1);
          if (last?.variant === "tool-results") {
            return [
              ...current.slice(0, -1),
              { ...last, content: `${last.content}\n${lines.join("\n")}` },
            ];
          }
          return [...current, {
            id: `assistant-tool-result-${Date.now()}-${displayedToolEventSequence}`,
            role: "assistant" as const,
            content: lines.join("\n"),
            source: "工具结果",
            variant: "tool-results" as const,
          }];
        });
      }

      function showTaskToolResults(response: AssistantTaskResponse) {
        const plan = response.plan;
        if (!plan) return;
        appendToolResults((plan.discoverySteps ?? []).map((step) => `✓ ${step}`));
      }

      function showPageToolResults(records: AssistantToolExecutionRecord[]) {
        appendToolResults(records.map((record) => {
          const failed = isAssistantOperationError(record.result);
          const reason = failed && record.result && typeof record.result === "object"
            ? String((record.result as { reason?: unknown }).reason ?? "unknown_error")
            : "";
          return `${failed ? "×" : "✓"} ${record.tool}${reason ? ` · ${reason}` : ""}`;
        }));
      }

      function showModelReasoning(plan: AssistantPlan, taskPlanLength: number) {
        if (!plan.thought && !plan.actionExplanation) return;
        displayedToolEventSequence += 1;
        setAssistantMessages((current) => [...current, {
          id: `assistant-reasoning-${Date.now()}-${displayedToolEventSequence}`,
          role: "assistant" as const,
          content: taskPlanLength && plan.planStep ? `计划进度 ${plan.planStep}/${taskPlanLength}` : "本轮决策",
          source: "模型过程",
          variant: "reasoning" as const,
          thought: plan.thought,
          actionExplanation: plan.actionExplanation,
        }]);
      }

      function syncTaskPlan(response: AssistantTaskResponse) {
        setAssistantTaskIntent(response.taskIntent ?? null);
        if (!response.taskPlan.length) {
          setAssistantTaskPlan(null);
          return;
        }
        const currentStep = Math.min(
          response.taskPlan.length,
          Math.max(1, response.plan?.planStep ?? response.context?.currentPlanStep ?? 1),
        );
        setAssistantTaskPlan({
          steps: response.taskPlan,
          currentStep: response.status === "completed" ? response.taskPlan.length : currentStep,
          completed: response.status === "completed",
        });
      }

      let task: AssistantTaskResponse;
      if (pendingTask) {
        assistantTaskIdRef.current = pendingTask.taskId;
        task = await parseTaskResponse(await apiFetch(`/api/assistant/tasks/${encodeURIComponent(pendingTask.taskId)}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "user_input", text }),
          signal: abortController.signal,
        }));
      } else {
        const taskId = crypto.randomUUID();
        assistantTaskIdRef.current = taskId;
        const loadedInitialRegistry = await loadAssistantPageRegistry(initialPageId, abortController.signal);
        const initialRegistry = applyRuntimePageCapabilities(
          loadedInitialRegistry,
          runtimeCapabilitiesFor(initialPageId),
        );
        task = await parseTaskResponse(await apiFetch("/api/assistant/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            text,
            provider: selectedProvider,
            context: {
              currentPageRegistry: initialRegistry,
              history: [],
              backendToolResults: [],
            },
          }),
          signal: abortController.signal,
        }));
      }

      syncTaskPlan(task);
      if (!pendingTask && task.taskPlan.length) setAssistantProgress(`计划第 ${task.plan?.planStep ?? 1}/${task.taskPlan.length} 步：${task.taskPlan[(task.plan?.planStep ?? 1) - 1]}`);
      showTaskToolResults(task);

      for (let pageResumeCount = 0; task.status === "waiting_page" && pageResumeCount < MAX_ASSISTANT_PAGE_RESUMES; pageResumeCount += 1) {
        throwIfAssistantAborted(abortController.signal);
        const plan = task.plan;
        if (!plan) throw new Error("assistant_task_plan_missing");
        const toolPlanSignature = JSON.stringify(plan.toolCalls);
        if (toolPlanSignature === previousToolPlanSignature) identicalToolPlanCount += 1;
        else {
          previousToolPlanSignature = toolPlanSignature;
          identicalToolPlanCount = 1;
        }
        if (identicalToolPlanCount > MAX_IDENTICAL_TOOL_PLANS) {
          throw new Error("assistant_repeated_tool_plan");
        }
        lastExecutedPlan = plan;
        setAssistantRecognized(plan.recognized ?? []);
        showModelReasoning(plan, task.taskPlan.length);
        setAssistantProgress(task.taskPlan.length
          ? `正在执行计划 ${plan.planStep ?? task.context?.currentPlanStep ?? 1}/${task.taskPlan.length}`
          : "正在执行当前操作");
        const execution = await executeAssistantTools(
          plan.toolCalls,
          currentPage,
          currentOpenTabs,
          lastExecutionResult?.executionResult,
          `${task.taskId}:${pageResumeCount}`,
          abortController.signal,
        );
        throwIfAssistantAborted(abortController.signal);
        showPageToolResults(execution.toolResults);
        lastExecutionResult = execution;
        currentPage = execution.currentPage;
        currentOpenTabs = execution.openTabs;

        const previousContext = task.context ?? {};
        let currentPageRegistry = previousContext.currentPageRegistry;
        if (execution.openedPageId) {
          const openedPageRegistry = await loadAssistantPageRegistry(execution.openedPageId, abortController.signal);
          if (openedPageRegistry && typeof openedPageRegistry === "object") {
            currentPageRegistry = applyRuntimeFieldOptions(openedPageRegistry, execution.runtimeFieldOptions);
            currentPageRegistry = applyRuntimePageCapabilities(
              currentPageRegistry,
              execution.runtimePageCapabilities[execution.openedPageId],
            );
          }
        }
        if (currentPageRegistry && typeof currentPageRegistry === "object") {
          currentPageRegistry = applyRuntimeFieldOptions(currentPageRegistry, execution.runtimeFieldOptions);
          const registryPageId = String((currentPageRegistry as { pageId?: unknown }).pageId ?? "");
          currentPageRegistry = applyRuntimePageCapabilities(
            currentPageRegistry,
            execution.runtimePageCapabilities[registryPageId],
          );
        }

        const nextContext: AssistantContinuationContext = {
          currentPageRegistry,
          history: [
            ...(previousContext.history ?? []),
            { toolCalls: plan.toolCalls },
          ].slice(-MAX_ASSISTANT_HISTORY_ROUNDS),
          lastOperationResult: execution.executionResult,
          backendToolResults: (plan.backendToolResults ?? previousContext.backendToolResults ?? [])
            .slice(-MAX_ASSISTANT_BACKEND_RESULTS),
          currentPlanStep: plan.planStep ?? previousContext.currentPlanStep,
        };

        task = await parseTaskResponse(await apiFetch(`/api/assistant/tasks/${encodeURIComponent(task.taskId)}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "page_result", context: nextContext }),
          signal: abortController.signal,
        }));
        syncTaskPlan(task);
        showTaskToolResults(task);
      }

      if (task.status === "waiting_page") {
        throw new Error("assistant_task_page_resume_limit");
      }

      setAssistantRecognized([]);
      const finalPlan = task.plan ?? lastExecutedPlan;
      if (task.status === "waiting_user") {
        const question = task.question ?? finalPlan?.userInputRequest?.question ?? "请补充完成任务所需的信息。";
        setAssistantPendingTask({
          taskId: task.taskId,
          question,
          requestedFields: task.requestedFields ?? finalPlan?.userInputRequest?.requestedFields ?? [],
        });
        appendAssistantMessage({
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: question,
          source: `${selectedProviderLabel} 回复`,
          thought: finalPlan?.thought,
          actionExplanation: finalPlan?.actionExplanation,
          systemNote: "任务已由 LangGraph 暂停，回复后将从当前检查点继续。",
        });
        return;
      }

      if (!finalPlan) throw new Error("assistant_task_plan_missing");
      assistantTaskIdRef.current = null;
      const lastToolCall = finalPlan.toolCalls.at(-1);
      const finalOperation = lastExecutionResult?.executionResult as { type?: unknown; success?: unknown } | undefined;
      const resultSummary =
        finalOperation?.type === "mutation_result" && finalOperation.success === true
          ? "数据变更已保存并返回成功结果。"
          : task.status === "cancelled"
            ? "任务已取消。"
          : lastToolCall?.tool === "click_button" && lastToolCall.args.actionId === "search"
          ? "查询结果已经刷新，等待 Agent 根据结果继续判断。"
          : lastToolCall?.tool === "set_field"
            ? "已更新页面筛选字段并刷新对应结果。"
          : lastToolCall?.tool === "click_list_row_action"
            ? `已执行：${formatToolCall(lastToolCall)}。`
            : lastToolCall?.tool === "click_list_item_action"
              ? `已执行：${formatToolCall(lastToolCall)}。`
            : task.status === "completed"
              ? "LangGraph 任务已完成。"
              : "已执行当前步骤。";

      appendAssistantMessage({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: finalPlan.reply,
        source: `${selectedProviderLabel} 回复`,
        thought: finalPlan.thought,
        actionExplanation: finalPlan.actionExplanation,
        systemNote: resultSummary,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setAssistantRecognized([]);
        appendAssistantMessage({
          id: `assistant-stopped-${Date.now()}`,
          role: "assistant",
          content: "已手动停止本次任务。已完成的页面操作会保留，后续步骤不再执行。",
          source: "系统",
        });
        return;
      }
      appendAssistantMessage({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error && error.message !== "assistant_task_failed"
          ? `执行过程中出现异常：${error.message}`
          : "执行过程中出现异常，本次任务已停止。",
        source: "系统",
      });
    } finally {
      if (assistantAbortControllerRef.current === abortController) assistantAbortControllerRef.current = null;
      setAssistantBusy(false);
      setAssistantStopping(false);
      setAssistantProgress(null);
    }
  }

  function stopAssistantExecution() {
    const controller = assistantAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setAssistantStopping(true);
    setAssistantProgress("正在停止当前任务，已完成的操作将保留。");
    const taskId = assistantTaskIdRef.current;
    if (taskId) {
      void apiFetch(`/api/assistant/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" })
        .catch(() => undefined);
    }
    controller.abort();
    assistantTaskIdRef.current = null;
    setAssistantPendingTask(null);
  }

  async function clearAssistantHistory() {
    if (assistantBusy || assistantPendingTask || assistantMemoryClearing) return;
    if (!window.confirm("确定清除当前账号的 Agent 历史记忆吗？清除后无法恢复。")) return;
    setAssistantMemoryClearing(true);
    try {
      const response = await apiFetch("/api/assistant/memory", { method: "DELETE" });
      if (!response.ok) throw new Error("assistant_memory_clear_failed");
      setAssistantMessages([ASSISTANT_WELCOME_MESSAGE]);
      setAssistantRecognized([]);
    } catch {
      window.alert("清除历史记忆失败，请稍后重试。");
    } finally {
      setAssistantMemoryClearing(false);
    }
  }

  const totalPolicyPages = Math.max(1, Math.ceil(policyTotal / POLICY_PAGE_SIZE));
  const selectedStatusLabel =
    policyStatusOptions.find((option) => option.value === filters.policyStatus)?.label ?? "全部";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand">
            <span className="topbar-brand-mark" aria-hidden="true">hA</span>
            <span><strong>healthAgent</strong><small>团体健康险理赔平台</small></span>
          </div>
          <nav className="topnav" ref={topNavRef}>
            {hasAnyRole("claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer") && <div className="menu-item active">
              <button className="menu-trigger" onClick={() => { setMenuOpen((value) => !value); setClaimMenuOpen(false); setConfigMenuOpen(false); setSystemMenuOpen(false); }}>
                综合查询 ▾
              </button>
              <div className={`dropdown ${menuOpen ? "" : "hidden"}`}>
                <button className="dropdown-item" onClick={() => { openMainTab("policy"); setMenuOpen(false); }}>
                  保单信息查询
                </button>
                <button className="dropdown-item" onClick={() => { openMainTab("claim"); setMenuOpen(false); }}>
                  案件查询
                </button>
              </div>
            </div>}
            {hasAnyRole("claim_admin") && <div className="menu-item">
              <button className="menu-trigger" onClick={() => { setConfigMenuOpen((value) => !value); setMenuOpen(false); setClaimMenuOpen(false); setSystemMenuOpen(false); }}>
                理赔配置 ▾
              </button>
              <div className={`dropdown ${configMenuOpen ? "" : "hidden"}`}>
                <button className="dropdown-item" onClick={() => { openMainTab("calculation_config"); setConfigMenuOpen(false); }}>
                  保单理算配置
                </button>
                <button className="dropdown-item" onClick={() => { openMainTab("standard_formulas"); setConfigMenuOpen(false); }}>
                  标准公式管理
                </button>
              </div>
            </div>}
            {hasAnyRole("claim_acceptor", "claim_calculator", "claim_reviewer") && <div className="menu-item">
              <button className="menu-trigger" onClick={() => { setClaimMenuOpen((value) => !value); setMenuOpen(false); setConfigMenuOpen(false); setSystemMenuOpen(false); }}>
                理赔处理 ▾
              </button>
              <div className={`dropdown ${claimMenuOpen ? "" : "hidden"}`}>
                {hasAnyRole("claim_acceptor") && <button className="dropdown-item" onClick={() => { openMainTab("claim_registration"); setClaimMenuOpen(false); }}>受理立案</button>}
                {hasAnyRole("claim_calculator") && <button className="dropdown-item" onClick={() => { openMainTab("claim_entry_calculation"); setClaimMenuOpen(false); }}>录入与理算</button>}
                {hasAnyRole("claim_reviewer") && <button className="dropdown-item" onClick={() => { openMainTab("claim_review_completion"); setClaimMenuOpen(false); }}>审核结案</button>}
              </div>
            </div>}
            {hasAnyRole("claim_admin") && <div className="menu-item">
              <button className="menu-trigger" onClick={() => { setSystemMenuOpen((value) => !value); setMenuOpen(false); setClaimMenuOpen(false); setConfigMenuOpen(false); }}>
                系统管理 ▾
              </button>
              <div className={`dropdown ${systemMenuOpen ? "" : "hidden"}`}>
                <button className="dropdown-item" onClick={() => { openMainTab("audit_logs"); setSystemMenuOpen(false); }}>操作审计</button>
              </div>
            </div>}
          </nav>
        </div>
        <div className="topbar-right">
          <button
            className={`assistant-top-button ${assistantOpen ? "open" : ""}`}
            type="button"
            onClick={() => setAssistantOpen((value) => !value)}
          >
            <span aria-hidden="true">✦</span> 智能助手
          </button>
          <div className="user-menu" ref={userMenuRef}>
            <button
              className={`user-menu-trigger ${userMenuOpen ? "open" : ""}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((value) => !value)}
            >
              <span className="user-avatar">{userInitials(user.displayName)}</span>
              <span className="current-user">
                <strong>{user.displayName}</strong>
                <small>{user.roles.includes("claim_admin") ? "系统管理员" : APP_ROLE_LABELS[user.roles[0]] ?? "业务用户"}</small>
              </span>
              <span className="user-menu-caret" aria-hidden="true">⌄</span>
            </button>
            <div className={`user-dropdown ${userMenuOpen ? "" : "hidden"}`} role="menu">
              <div className="user-dropdown-profile">
                <span className="user-avatar large">{userInitials(user.displayName)}</span>
                <div><strong>{user.displayName}</strong><small>@{user.username}</small></div>
              </div>
              <div className="user-dropdown-section">
                <span className="user-dropdown-label">当前角色</span>
                <div className="user-role-list">
                  {user.roles.map((role) => <span key={role}>{APP_ROLE_LABELS[role]}</span>)}
                </div>
              </div>
              <div className="user-dropdown-meta"><span>账号 ID</span><strong>{user.id}</strong></div>
              <button className="user-logout-button" role="menuitem" type="button" onClick={() => void logout()}>
                <span aria-hidden="true">↪</span> 退出登录
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="tabs-bar">
          {openTabs.map((tab) => {
            const label = tab === "policy"
              ? "保单信息查询"
              : tab === "claim"
                ? "案件查询"
                : tab === "claim_registration"
                  ? "受理立案"
                  : tab === "claim_entry_calculation"
                    ? "录入与理算"
                    : tab === "claim_review_completion"
                      ? "审核结案"
                    : tab === "calculation_config"
                      ? "保单理算配置"
                      : tab === "standard_formulas"
                        ? "标准公式管理"
                      : "操作审计";
            return (
              <div className={`tab ${mainTab === tab ? "active" : ""}`} key={tab}>
                <button className="tab-button" aria-current={mainTab === tab ? "page" : undefined} onClick={() => setMainTab(tab)}>{label}</button>
                <button className="tab-close" type="button" aria-label={`关闭${label}`} onClick={() => closeMainTab(tab)}>×</button>
              </div>
            );
          })}
        </div>

        {openTabs.length === 0 && <section className="panel empty-state"><h3>暂无打开的页面</h3><p>可通过顶部菜单重新打开功能页面。</p></section>}

        <section className={`page-section ${openTabs.includes("policy") && mainTab === "policy" ? "" : "hidden"}`}>
          <section className="panel query-panel">
            <div className="section-title">查询条件</div>
            <form className="query-form" onSubmit={(e) => { e.preventDefault(); void loadPolicies(filters); }}>
              <label>
                <span>保单号</span>
                <input className="filter-control" value={filters.policyNo} onChange={(e) => setFilters((p) => ({ ...p, policyNo: e.target.value }))} placeholder="例如 GI2026000001" />
              </label>
              <label>
                <span>投保单位</span>
                <input className="filter-control" value={filters.applicantName} onChange={(e) => setFilters((p) => ({ ...p, applicantName: e.target.value }))} placeholder="例如 华曜科技" />
              </label>
              <label>
                <span>被保人姓名</span>
                <input className="filter-control" value={filters.insuredName} onChange={(e) => setFilters((p) => ({ ...p, insuredName: e.target.value }))} placeholder="例如 张晨" />
              </label>
              <label>
                <span>被保人证件号</span>
                <input className="filter-control" value={filters.insuredIdNo} onChange={(e) => setFilters((p) => ({ ...p, insuredIdNo: e.target.value }))} placeholder="例如 310101..." />
              </label>
              <label>
                <span>保单状态</span>
                <div className="custom-select" ref={selectRef}>
                  <button type="button" className="filter-control custom-select-trigger" aria-haspopup="listbox" aria-expanded={statusOpen} onClick={() => setStatusOpen((v) => !v)}>
                    <span>{selectedStatusLabel}</span>
                    <span className="select-arrow">▾</span>
                  </button>
                  <div className={`custom-select-menu ${statusOpen ? "" : "hidden"}`}>
                    {policyStatusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`custom-select-option ${filters.policyStatus === option.value ? "active" : ""}`}
                        onClick={() => {
                          setFilters((prev) => ({ ...prev, policyStatus: option.value }));
                          setStatusOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </label>
              <div className="query-actions">
                <button type="submit">查询</button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const next = { ...EMPTY_POLICY_FILTERS };
                    setFilters(next);
                    void loadPolicies(next);
                  }}
                >
                  重置
                </button>
              </div>
            </form>
          </section>

          <section className="panel result-panel">
            <div className="panel-title-row">
              <div className="section-title">查询结果</div>
              <span className="muted">{policyTotal} 条</span>
            </div>
            <div className="result-table-shell">
              <div className="table-wrapper result-table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="index-col">序号</th>
                      <th>保单号</th>
                      <th>保单名称</th>
                      <th>投保单位</th>
                      <th>状态</th>
                      <th>生效日期</th>
                      <th>终止日期</th>
                      <th>被保人数</th>
                      <th className="actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.length > 0 ? (
                      policies.map((item, index) => (
                        <tr key={item.id} className={activePolicyId === item.id ? "active-row" : ""}>
                          <td>{(policyPage - 1) * POLICY_PAGE_SIZE + index + 1}</td>
                          <td>{item.policyNo}</td>
                          <td>{item.policyName ?? "-"}</td>
                          <td>{item.applicantName}</td>
                          <td>{formatPolicyStatus(item.policyStatus)}</td>
                          <td>{item.effectiveDate}</td>
                          <td>{item.expiryDate}</td>
                          <td>{item.insuredCount}</td>
                          <td className="actions-cell">
                            <button className="action-link" onClick={() => void openPolicyDrawer(item.id, "basic")}>详细信息</button>
                            <button className="action-link" onClick={() => void openPolicyDrawer(item.id, "benefits")}>责任信息</button>
                            <button className="action-link" onClick={() => void openPolicyDrawer(item.id, "insureds")}>被保人信息</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>没有找到符合条件的保单。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={policyPage}
                totalPages={totalPolicyPages}
                total={policyTotal}
                onChange={(page) => { void loadPolicies(filters, page); }}
              />
            </div>
          </section>

          <div className={`drawer-overlay ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}>
            <aside className="drawer-panel">
              <div className="drawer-header">
                <div>
                  <div className="section-title">保单详情</div>
                  <div className="muted">
                    {drawerData ? `${drawerData.policy.policyNo} ｜ ${drawerData.policy.policyName ?? ""} ｜ ${drawerData.policy.applicantName}` : ""}
                  </div>
                </div>
                <div className="page-header-actions">
                  <span className={`status-badge ${drawerData?.policy.policyStatus ?? ""}`}>
                    {formatPolicyStatus(drawerData?.policy.policyStatus)}
                  </span>
                  <button className="page-back-button" onClick={() => setDrawerOpen(false)}>返回上一页</button>
                </div>
              </div>
              <div className="drawer-body">
                <div className="drawer-tabs">
                  <button className={`detail-tab ${drawerTab === "basic" ? "active" : ""}`} onClick={() => setDrawerTab("basic")}>详细信息</button>
                  <button className={`detail-tab ${drawerTab === "benefits" ? "active" : ""}`} onClick={() => setDrawerTab("benefits")}>责任信息</button>
                  <button
                    className={`detail-tab ${drawerTab === "insureds" ? "active" : ""}`}
                    onClick={() => {
                      setDrawerTab("insureds");
                      if (drawerData) void loadPolicyInsureds(drawerData.policy.id);
                    }}
                  >
                    被保人信息
                  </button>
                </div>
                <div className="drawer-content">
                  {drawerData && drawerTab === "basic" && <BasicView data={drawerData} />}
                  {drawerData && drawerTab === "benefits" && <BenefitsView plans={drawerData.coveragePlans} products={drawerData.products} />}
                  {drawerData && drawerTab === "insureds" && (
                    <InsuredsView
                      insureds={insureds}
                      plans={drawerData.coveragePlans}
                      selectedPlanId={insuredPlanId}
                      total={insuredTotal}
                      page={insuredPage}
                      setSelectedPlanId={(planId) => {
                        updateInsuredPlanId(planId);
                        void loadPolicyInsureds(drawerData.policy.id, 1, planId);
                      }}
                      setPage={(page) => { void loadPolicyInsureds(drawerData.policy.id, page); }}
                      onViewLedger={(item) => void openInsuredLedger(item)}
                    />
                  )}
                </div>
              </div>
            </aside>
          </div>
          {insuredLedgerOpen ? (
            <div className="insured-ledger-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setInsuredLedgerOpen(false); }}>
              <section className="insured-ledger-dialog" role="dialog" aria-modal="true" aria-labelledby="insured-ledger-title">
                <div className="insured-ledger-header">
                  <div>
                    <div className="section-title" id="insured-ledger-title">被保人当前保单台账</div>
                    <small>{insuredLedgerData?.insuredPerson.name ?? "-"} ｜ {insuredLedgerData?.insuredPerson.insuredNo ?? "-"} ｜ {drawerData?.policy.policyNo ?? "-"}</small>
                  </div>
                  <button type="button" className="page-back-button" onClick={() => setInsuredLedgerOpen(false)}>关闭</button>
                </div>
                <div className="insured-ledger-content">
                  {insuredLedgerLoading ? <div className="config-empty-cell">正在加载台账…</div> : insuredLedgerError ? <div className="field-error">{insuredLedgerError}</div> : insuredLedgerData?.items.length ? (
                    <div className="table-wrapper"><table><thead><tr><th>年度</th><th>层级</th><th>对象编码</th><th>对象名称</th><th>台账项目</th><th>当前值</th><th>更新时间</th></tr></thead><tbody>
                      {insuredLedgerData.items.map((item) => <tr key={item.id}><td>{item.periodYear}</td><td><span className="status-badge">{item.scope}</span></td><td><code>{item.targetCode}</code></td><td>{item.targetName}</td><td>{item.ledgerName}</td><td><strong>¥ {item.currentAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td><td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td></tr>)}
                    </tbody></table></div>
                  ) : <div className="config-empty-cell">该被保人在当前保单下暂无台账记录。</div>}
                </div>
              </section>
            </div>
          ) : null}
        </section>

        <section className={`page-section ${openTabs.includes("claim") && mainTab === "claim" ? "" : "hidden"}`}>
          <ClaimQueryPage ref={claimQueryControllerRef} />
        </section>

        <section className={`page-section ${openTabs.includes("claim_registration") && mainTab === "claim_registration" ? "" : "hidden"}`}>
          <ClaimRegistrationPage ref={claimRegistrationControllerRef} />
        </section>

        <section className={`page-section ${openTabs.includes("claim_entry_calculation") && mainTab === "claim_entry_calculation" ? "" : "hidden"}`}>
          <ClaimEntryCalculationPage ref={claimEntryCalculationControllerRef} />
        </section>

        <section className={`page-section ${openTabs.includes("claim_review_completion") && mainTab === "claim_review_completion" ? "" : "hidden"}`}>
          <ClaimEntryCalculationPage ref={claimReviewCompletionControllerRef} mode="review" />
        </section>
        {openTabs.includes("audit_logs") && mainTab === "audit_logs" && <AuditLogPage />}

        <section className={`page-section ${openTabs.includes("calculation_config") && mainTab === "calculation_config" ? "" : "hidden"}`}>
          <CalculationConfigPage ref={calculationConfigControllerRef} />
        </section>

        <section className={`page-section ${openTabs.includes("standard_formulas") && mainTab === "standard_formulas" ? "" : "hidden"}`}>
          <StandardFormulaManagementPage ref={standardFormulaControllerRef} />
        </section>
      </main>

      <section className={`assistant-panel ${assistantOpen ? "open" : ""}`} aria-hidden={!assistantOpen}>
        <div className="assistant-panel-header">
          <div>
            <div className="assistant-title">智能助手</div>
            <div className="assistant-subtitle">输入自然语言，我会理解后自动操作页面</div>
            <div className="assistant-model-select-label" ref={modelSelectRef}>
              <span>模型</span>
              <div className="assistant-model-select">
                <button
                  type="button"
                  className="assistant-model-select-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={modelSelectOpen}
                  disabled={assistantBusy}
                  onClick={() => setModelSelectOpen((open) => !open)}
                >
                  <span>{llmProviderOptions.find((option) => option.value === llmProvider)?.label}</span>
                  <span className="select-arrow">▾</span>
                </button>
                <div className={`assistant-model-select-menu ${modelSelectOpen ? "" : "hidden"}`} role="listbox">
                  {llmProviderOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={llmProvider === option.value}
                      className={llmProvider === option.value ? "active" : ""}
                      onClick={() => {
                        setLlmProvider(option.value);
                        setModelSelectOpen(false);
                        window.localStorage.setItem(LLM_PROVIDER_STORAGE_KEY, option.value);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="assistant-header-actions">
            <button
              className="assistant-clear-memory"
              type="button"
              disabled={assistantBusy || Boolean(assistantPendingTask) || assistantMemoryLoading || assistantMemoryClearing}
              onClick={() => void clearAssistantHistory()}
            >
              {assistantMemoryClearing ? "清除中" : "清除记忆"}
            </button>
            <button className="assistant-close" type="button" onClick={() => setAssistantOpen(false)}>
              收起
            </button>
          </div>
        </div>

        <div className="assistant-messages" ref={assistantMessagesRef}>
          {assistantMessages.map((message) => (
            <article key={message.id} className={`assistant-message ${message.role}${message.variant ? ` ${message.variant}` : ""}`}>
              <div className="assistant-message-role">
                {message.role === "assistant" ? (message.source ?? "助手") : "我"}
              </div>
              <div className="assistant-message-content">{message.content}</div>
              {(message.thought || message.actionExplanation) && message.variant !== "tool-results" ? (
                <details className="assistant-model-reasoning">
                  <summary>
                    <strong>思考与行动解释</strong>
                    <span>{message.actionExplanation ?? message.thought}</span>
                  </summary>
                  <div className="assistant-model-reasoning-body">
                    {message.thought ? <p><strong>思考</strong><span>{message.thought}</span></p> : null}
                    {message.actionExplanation ? <p><strong>行动解释</strong><span>{message.actionExplanation}</span></p> : null}
                  </div>
                </details>
              ) : null}
              {message.systemNote ? (
                <div className="assistant-system-note">
                  <strong>系统结果</strong>
                  <span>{message.systemNote}</span>
                </div>
              ) : null}
              {message.steps && message.steps.length > 0 ? (
                <div className="assistant-execution-log">
                  <div>工具执行记录</div>
                  <ul className="assistant-steps">
                    {message.steps.map((step, index) => (
                      <li key={`${message.id}-step-${index}`}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>

        {assistantBusy && assistantProgress ? (
          <div className="assistant-progress" aria-live="polite">
            <span>执行中</span>
            <p>{assistantProgress}</p>
          </div>
        ) : null}

        {assistantRecognized.length > 0 ? (
          <div className="assistant-recognized">
            <div className="assistant-recognized-title">本次识别</div>
            <ul className="assistant-steps compact">
              {assistantRecognized.map((item, index) => (
                <li key={`recognized-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {assistantTaskIntent || assistantTaskPlan ? (
          <div className={`assistant-plan-dock ${assistantPlanExpanded ? "expanded" : ""}`}>
            <button
              type="button"
              className="assistant-plan-toggle"
              aria-expanded={assistantPlanExpanded}
              onClick={() => setAssistantPlanExpanded((expanded) => !expanded)}
            >
              <span>任务理解与行动计划</span>
              {assistantTaskPlan ? <span className="assistant-plan-count">
                {assistantTaskPlan.completed ? assistantTaskPlan.steps.length : assistantTaskPlan.currentStep}/{assistantTaskPlan.steps.length}
              </span> : null}
              <span className="assistant-plan-arrow">{assistantPlanExpanded ? "⌄" : "⌃"}</span>
            </button>
            {assistantPlanExpanded ? (
              <div className="assistant-plan-details">
                {assistantTaskIntent ? <div className="assistant-task-intent">
                  <p><strong>意图：</strong>{ASSISTANT_INTENT_LABELS[assistantTaskIntent.mode]}</p>
                  <p><strong>目标：</strong>{assistantTaskIntent.summary}</p>
                  {assistantTaskIntent.objectives.length ? <ul>
                    {assistantTaskIntent.objectives.map((objective, index) => <li key={`assistant-objective-${index}`}>{objective}</li>)}
                  </ul> : null}
                </div> : null}
                {assistantTaskPlan ? <ol className="assistant-plan-steps">
                {assistantTaskPlan.steps.map((step, index) => {
                  const stepNumber = index + 1;
                  const completed = assistantTaskPlan.completed || stepNumber < assistantTaskPlan.currentStep;
                  const current = !assistantTaskPlan.completed && stepNumber === assistantTaskPlan.currentStep;
                  return (
                    <li key={`assistant-plan-step-${index}`} className={completed ? "completed" : current ? "current" : "pending"}>
                      <span>{completed ? "✓" : stepNumber}</span>
                      <p>{step}</p>
                    </li>
                  );
                })}
              </ol> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="assistant-input-area">
          <textarea
            className="assistant-textarea"
            placeholder={assistantPendingTask ? `请补充：${assistantPendingTask.question}` : "例如：查张三有哪些保单"}
            value={assistantInput}
            onChange={(e) => setAssistantInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && assistantInput.trim()) {
                event.preventDefault();
                void handleAssistantSubmit();
              }
            }}
          />
          <div className="assistant-input-actions">
            {assistantBusy ? <button type="button" className="assistant-stop-button" onClick={stopAssistantExecution} disabled={assistantStopping}>{assistantStopping ? "停止中…" : "停止"}</button> : null}
            <button type="button" onClick={() => void handleAssistantSubmit()} disabled={assistantBusy}>
              {assistantBusy ? "执行中..." : "执行"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
