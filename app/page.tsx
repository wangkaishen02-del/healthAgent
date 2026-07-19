"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatToolCall, type AssistantPlan, type AssistantToolCall } from "../src/assistant/policy-query-assistant";
import type { RegisteredPageController } from "../src/assistant/page-controller";
import type { PageRegistration, RegisteredRegion } from "../src/assistant/page-registry";
import type { CoveragePlan, PageResult, PolicyDetailView, PolicyInsuredView, PolicyListItem, PolicyProductView } from "../src/underwriting/types";
import CalculationConfigPage from "./components/CalculationConfigPage";
import ClaimRegistrationPage from "./components/ClaimRegistrationPage";

type MainTab = "policy" | "claim" | "claim_registration" | "calculation_config";
type DrawerTab = "basic" | "benefits" | "insureds";
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
};

const POLICY_PAGE_SIZE = 10;
const INSURED_PAGE_SIZE = 10;
const ASSISTANT_POLICY_CONTEXT_LIMIT = 5;
const ASSISTANT_LIST_CONTEXT_LIMIT = 5;
const MAX_ASSISTANT_EXECUTION_ROUNDS = 12;
const LLM_PROVIDER_STORAGE_KEY = "health-agent-llm-provider";
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

function pageIdToMainTab(pageId: string): MainTab | null {
  if (pageId === "policy_query" || pageId === "policy_detail") return "policy";
  if (pageId === "claim_query") return "claim";
  if (pageId === "claim_registration") return "claim_registration";
  if (pageId === "calculation_config") return "calculation_config";
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

function formatPolicyStatus(value?: string) {
  if (value === "enabled") return "启用";
  if (value === "disabled") return "停用";
  if (value === "active") return "启用";
  if (value === "inactive") return "停用";
  return value ?? "-";
}

function formatDateRange(start: string, end: string) {
  return `${start} ~ ${end}`;
}

function formatGender(value?: string) {
  if (value === "male") return "男";
  if (value === "female") return "女";
  return "-";
}

function formatInsuredRole(value?: string) {
  if (value === "employee") return "员工";
  if (value === "spouse") return "配偶";
  if (value === "child") return "子女";
  if (value === "parent") return "父母";
  return "-";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Pagination({
  currentPage,
  totalPages,
  total,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pageItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = [1, currentPage - 1, currentPage, currentPage + 1, totalPages]
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b)
      .filter((page, index, values) => index === 0 || page !== values[index - 1]);
    return pages.flatMap((page, index) => {
      const previous = pages[index - 1];
      return index > 0 && page - previous > 1 ? ["ellipsis" as const, page] : [page];
    });
  }, [currentPage, totalPages]);

  return (
    <div className="pagination">
      <span className="pagination-info">
        第 {currentPage} / {totalPages} 页，共 {total} 条
      </span>
      <button className="page-btn" disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)}>
        上一页
      </button>
      {pageItems.map((page, index) => page === "ellipsis" ? (
        <span className="pagination-info" key={`ellipsis-${index}`}>…</span>
      ) : (
        <button
          key={page}
          className={`page-btn ${page === currentPage ? "active" : ""}`}
          onClick={() => onChange(page)}
        >
          {page}
        </button>
      ))}
      <button className="page-btn" disabled={currentPage === totalPages} onClick={() => onChange(currentPage + 1)}>
        下一页
      </button>
    </div>
  );
}

function BasicView({ data }: { data: PolicyDetailView }) {
  const summary = [
    { label: "保障计划数", value: data.coveragePlans.length },
    { label: "险种数", value: data.products.length },
    { label: "责任数", value: data.products.reduce((sum, item) => sum + item.benefits.length, 0) },
    { label: "被保人数", value: data.insuredCount },
  ];
  const basic = [
    { label: "保单号", value: data.policy.policyNo },
    { label: "保单名称", value: data.policy.policyName },
    { label: "投保单位", value: data.policy.applicantName },
    { label: "投保人类型", value: data.policy.holderType === "company" ? "单位" : "团体" },
    { label: "生效日期", value: data.policy.effectiveDate },
    { label: "终止日期", value: data.policy.expiryDate },
    { label: "承保日期", value: data.policy.underwritingDate },
    { label: "总保费", value: data.policy.totalPremium ?? "-" },
    { label: "保单状态", value: formatPolicyStatus(data.policy.policyStatus) },
  ];

  return (
    <div className="grid two">
      <section className="subpanel">
        <h3>保单基本信息</h3>
        <div className="kv-grid">
          {basic.map((item) => (
            <div className="kv-item" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value ?? "-"}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="subpanel">
        <h3>概览</h3>
        <div className="summary-grid">
          {summary.map((item) => (
            <div className="summary-item" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function BenefitsView({ plans, products }: { plans: CoveragePlan[]; products: PolicyProductView[] }) {
  const [collapsedHierarchyKeys, setCollapsedHierarchyKeys] = useState<Set<string>>(() => new Set());
  const benefits = products.flatMap((product) =>
    product.benefits.map((benefit) => ({ product, benefit })),
  );
  const hierarchyRows = plans.flatMap((plan) => {
    const planKey = `plan-${plan.id}`;
    const planProducts = products.filter((product) => product.coveragePlanId === plan.id);
    return [
      {
        key: planKey,
        level: 0,
        scope: "plan",
        scopeLabel: "保障计划",
        code: plan.planCode,
        name: plan.planName,
        ancestorKeys: [] as string[],
        hasChildren: planProducts.length > 0,
      },
      ...planProducts.flatMap((product) => {
        const productKey = `product-${product.id}`;
        return [{
          key: productKey,
          level: 1,
          scope: "product",
          scopeLabel: "险种",
          code: product.productCode,
          name: product.productName,
          ancestorKeys: [planKey],
          hasChildren: product.benefits.length > 0,
        },
        ...product.benefits.map((benefit) => ({
          key: `benefit-${benefit.id}`,
          level: 2,
          scope: "benefit",
          scopeLabel: "责任",
          code: benefit.benefitCode,
          name: benefit.benefitName,
          ancestorKeys: [planKey, productKey],
          hasChildren: false,
        }))];
      }),
    ];
  });
  const hierarchyIdentity = hierarchyRows.map((row) => row.key).join("|");
  const visibleHierarchyRows = hierarchyRows.filter((row) =>
    row.ancestorKeys.every((key) => !collapsedHierarchyKeys.has(key)),
  );

  useEffect(() => {
    setCollapsedHierarchyKeys(new Set());
  }, [hierarchyIdentity]);

  function toggleHierarchyRow(key: string) {
    setCollapsedHierarchyKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <div className="panel-title-row">
        <h3>保障计划、险种与责任</h3>
        <span className="muted">{plans.length} 个保障计划，{products.length} 个险种，{benefits.length} 项责任</span>
      </div>
      <div className="detail-table-shell">
        <div className="table-wrapper detail-table-wrapper benefits-table-wrapper config-hierarchy-table">
          <table className="compact-table hierarchy-fixed-table benefits-hierarchy-table">
            <thead>
              <tr>
                <th>层级</th>
                <th>对象编码</th>
                <th>对象名称</th>
              </tr>
            </thead>
            <tbody>
              {visibleHierarchyRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="config-tree-level" style={{ paddingLeft: `${row.level * 12}px` }}>
                      {row.hasChildren ? (
                        <button
                          type="button"
                          className="config-tree-toggle"
                          aria-expanded={!collapsedHierarchyKeys.has(row.key)}
                          aria-label={`${collapsedHierarchyKeys.has(row.key) ? "展开" : "收起"}${row.scopeLabel}${row.name}`}
                          onClick={() => toggleHierarchyRow(row.key)}
                        >
                          {collapsedHierarchyKeys.has(row.key) ? "▸" : "▾"}
                        </button>
                      ) : <span className="config-tree-toggle-placeholder" aria-hidden="true" />}
                      <span className={`config-level-badge ${row.scope}`}>{row.scopeLabel}</span>
                    </span>
                  </td>
                  <td><code style={{ marginLeft: `${row.level * 12}px` }}>{row.code}</code></td>
                  <td><span className="config-tree-name" style={{ paddingLeft: `${row.level * 18}px` }}>{row.name}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CoveragePlanSelect({
  plans,
  value,
  onChange,
}: {
  plans: CoveragePlan[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement | null>(null);
  const selectedPlan = plans.find((plan) => plan.id === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="insured-plan-filter">
      <span>保障计划</span>
      <div className="custom-select" ref={selectRef}>
        <button
          type="button"
          className="filter-control custom-select-trigger"
          aria-label="保障计划筛选"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selectedPlan ? `${selectedPlan.planCode} / ${selectedPlan.planName}` : "全部保障计划"}</span>
          <span className="select-arrow">▾</span>
        </button>
        {open ? (
          <div className="custom-select-menu">
            <button
              type="button"
              className={`custom-select-option ${value === "" ? "active" : ""}`}
              onClick={() => { onChange(""); setOpen(false); }}
            >
              全部保障计划
            </button>
            {plans.map((plan) => (
              <button
                type="button"
                className={`custom-select-option ${value === plan.id ? "active" : ""}`}
                key={plan.id}
                onClick={() => { onChange(plan.id); setOpen(false); }}
              >
                {plan.planCode} / {plan.planName}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InsuredsView({
  insureds,
  plans,
  selectedPlanId,
  total,
  page,
  setSelectedPlanId,
  setPage,
}: {
  insureds: PolicyInsuredView[];
  plans: CoveragePlan[];
  selectedPlanId: string;
  total: number;
  page: number;
  setSelectedPlanId: (planId: string) => void;
  setPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / INSURED_PAGE_SIZE));

  return (
    <>
      <div className="panel-title-row">
        <h3>被保人清单</h3>
        <div className="insured-list-tools">
          <CoveragePlanSelect plans={plans} value={selectedPlanId} onChange={setSelectedPlanId} />
          <span className="muted">{total} 人</span>
        </div>
      </div>
      <div className="detail-table-shell">
        <div className="table-wrapper detail-table-wrapper">
          <table>
            <thead>
              <tr>
                <th className="index-col">序号</th>
                <th>被保人编号</th>
                <th>保障计划</th>
                <th>姓名</th>
                <th>性别</th>
                <th>出生日期</th>
                <th>手机号</th>
                <th>证件号</th>
                <th>被保角色</th>
                <th>加入日期</th>
                <th>保障期间</th>
              </tr>
            </thead>
            <tbody>
              {insureds.length > 0 ? insureds.map((item, index) => (
                <tr key={item.id}>
                  <td>{(page - 1) * INSURED_PAGE_SIZE + index + 1}</td>
                  <td>{item.insuredPerson.insuredNo}</td>
                  <td className="insured-plan-cell">
                    <code>{item.coveragePlan?.planCode ?? "-"}</code>
                    <span>{item.coveragePlan?.planName ?? "未关联保障计划"}</span>
                  </td>
                  <td>{item.insuredPerson.name}</td>
                  <td>{formatGender(item.insuredPerson.gender)}</td>
                  <td>{item.insuredPerson.birthDate ?? "-"}</td>
                  <td>{item.insuredPerson.phone ?? "-"}</td>
                  <td>{item.insuredPerson.idNo ?? "-"}</td>
                  <td>{formatInsuredRole(item.insuredRole)}</td>
                  <td>{item.joinDate ?? "-"}</td>
                  <td>{formatDateRange(item.effectiveDate, item.expiryDate)}</td>
                </tr>
              )) : (
                <tr><td className="config-empty-cell" colSpan={11}>该保障计划下没有被保人。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalPages={totalPages} total={total} onChange={setPage} />
      </div>
    </>
  );
}

export default function Page() {
  const [mainTab, setMainTab] = useState<MainTab>("policy");
  const [openTabs, setOpenTabs] = useState<MainTab[]>(["policy"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [claimMenuOpen, setClaimMenuOpen] = useState(false);
  const [configMenuOpen, setConfigMenuOpen] = useState(false);
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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("ollama");
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantProgress, setAssistantProgress] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content:
        "你好，我是智能助手。你可以直接说：查张三有哪些保单、查华曜科技的保单、查停用保单。",
    },
  ]);
  const [assistantRecognized, setAssistantRecognized] = useState<string[]>([]);
  const [assistantPendingTask, setAssistantPendingTask] = useState<{
    taskText: string;
    question: string;
    requestedFields: string[];
    context?: {
      currentPagePath?: string[];
      currentPageRegistry?: unknown;
      history?: Array<{ toolCalls: AssistantToolCall[] }>;
      lastOperationResult?: unknown;
      backendToolResults?: unknown[];
    };
  } | null>(null);
  const selectRef = useRef<HTMLDivElement | null>(null);
  const modelSelectRef = useRef<HTMLDivElement | null>(null);
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<PolicyFilters>(EMPTY_POLICY_FILTERS);
  const policiesRef = useRef<PolicyListItem[]>([]);
  const drawerDataRef = useRef<PolicyDetailView | null>(null);
  const insuredPlanIdRef = useRef("");
  const calculationConfigControllerRef = useRef<RegisteredPageController | null>(null);
  const claimRegistrationControllerRef = useRef<RegisteredPageController | null>(null);

  function updateInsuredPlanId(value: string) {
    insuredPlanIdRef.current = value;
    setInsuredPlanId(value);
  }

  function openMainTab(tab: MainTab) {
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
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!assistantOpen) return;
    const messages = assistantMessagesRef.current;
    if (messages) messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  }, [assistantOpen, assistantMessages, assistantProgress, assistantRecognized]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setStatusOpen(false);
      }
      if (modelSelectRef.current && !modelSelectRef.current.contains(event.target as Node)) {
        setModelSelectOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  async function loadPolicies(nextFilters: PolicyFilters, page = 1) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("page", String(page));
    params.set("pageSize", String(POLICY_PAGE_SIZE));
    const response = await fetch(`/api/policies?${params.toString()}`);
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
    const response = await fetch(`/api/policies/${policyId}/insureds?${params.toString()}`);
    const data: PageResult<PolicyInsuredView> = await response.json();
    setInsureds(data.items);
    setInsuredTotal(data.total);
    setInsuredPage(data.page);
    return data;
  }

  async function openPolicyDrawer(policyId: string, tab: DrawerTab) {
    setActivePolicyId(policyId);
    setDrawerTab(tab);
    setInsuredPage(1);
    updateInsuredPlanId("");
    const response = await fetch(`/api/policies/${policyId}/full-view`);
    const data: PolicyDetailView = await response.json();
    drawerDataRef.current = data;
    setDrawerData(data);
    setInsureds([]);
    setInsuredTotal(data.insuredCount);
    setDrawerOpen(true);
    const insuredResult = tab === "insureds" ? await loadPolicyInsureds(policyId, 1, "") : null;
    return { detail: data, insuredResult };
  }

  async function loadAssistantPageRegistry(pageId: string) {
    const response = await fetch(`/api/assistant/registry?resource=page&pageId=${encodeURIComponent(pageId)}`);
    const data = (await response.json()) as { page?: unknown };
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
  ) {
    const nextFilters: PolicyFilters = { ...filtersRef.current };
    let currentPolicies = policiesRef.current;
    let executionTab = initialTab;
    let lastOperationResult: unknown = previousOperationResult;
    let openedPageId: string | null = null;
    const steps: string[] = [];
    const registeredPageControllers: Record<string, RegisteredPageController | null> = {
      calculation_config: calculationConfigControllerRef.current,
      claim_registration: claimRegistrationControllerRef.current,
    };

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
            ? await fetch(`/api/policies/${encodeURIComponent(policy.id)}/insureds?${params.toString()}`).then((response) => response.json() as Promise<PageResult<PolicyInsuredView>>)
            : null;
          return {
            policyId: policy.id,
            policyNo: policy.policyNo,
            policyName: policy.policyName,
            applicantName: policy.applicantName,
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

    for (const toolCall of toolCalls) {
      // 页面动作有页面前置条件：即使 LLM 省略了 open_page，也不能在错误页面上执行。
      const requiredTab = toolCall.tool === "open_page" ? null : pageIdToMainTab(toolCall.args.pageId);
      if (requiredTab && (executionTab !== requiredTab || !executionOpenTabs.has(requiredTab))) {
        openMainTab(requiredTab);
        executionTab = requiredTab;
        executionOpenTabs.add(requiredTab);
        steps.push(formatToolCall({ tool: "open_page", args: { pageId: toolCall.args.pageId } }));
        await delay(120);
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
          await registeredPageControllers.calculation_config?.executeAction("reset");
        }
        if (targetTab === "claim_registration") {
          await registeredPageControllers.claim_registration?.executeAction("reset");
        }

        await delay(120);
        openMainTab(targetTab);
        executionTab = targetTab;
        executionOpenTabs.add(targetTab);
        openedPageId = toolCall.args.pageId;
        if (targetTab === "policy") await loadPolicies({ ...EMPTY_POLICY_FILTERS });
        continue;
      }

      steps.push(formatToolCall(toolCall));

      if (toolCall.tool === "set_field") {
        const executor = fieldExecutors[`${toolCall.args.pageId}.${toolCall.args.fieldId}`];
        const controller = registeredPageControllers[toolCall.args.pageId];
        lastOperationResult = executor
          ? await executor(toolCall.args.value)
          : controller
            ? await controller.setField(toolCall.args.fieldId, toolCall.args.value)
            : { type: "operation_error", reason: "field_executor_not_bound", pageId: toolCall.args.pageId, fieldId: toolCall.args.fieldId };
        await delay(180);
        continue;
      }

      if (toolCall.tool === "click_button") {
        const executor = pageActionExecutors[`${toolCall.args.pageId}.${toolCall.args.actionId}`];
        const controller = registeredPageControllers[toolCall.args.pageId];
        lastOperationResult = executor
          ? await executor()
          : controller
            ? await controller.executeAction(toolCall.args.actionId)
            : { type: "operation_error", reason: "action_executor_not_bound", pageId: toolCall.args.pageId, actionId: toolCall.args.actionId };
        await delay(220);
        continue;
      }

      if (toolCall.tool === "click_list_row_action") {
        const controller = registeredPageControllers[toolCall.args.pageId];
        if (controller) {
          lastOperationResult = await controller.executeRowAction(toolCall.args.actionId, toolCall.args.row);
          await delay(220);
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
            continue;
          }
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
          await delay(220);
        }
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
    Object.assign(runtimeFieldOptions, claimRegistrationControllerRef.current?.getRuntimeFieldOptions() ?? {});

    return {
      steps,
      currentPage: executionTab,
      openTabs: executionOpenTabs,
      openedPageId,
      runtimeFieldOptions,
      executionResult: lastOperationResult ?? {
        executedActions: toolCalls.map(formatToolCall),
      },
    };
  }

  async function handleAssistantSubmit() {
    const text = assistantInput.trim();
    if (!text || assistantBusy) return;
    const pendingTask = assistantPendingTask;
    const effectiveText = pendingTask
      ? `${pendingTask.taskText}\n用户补充信息：${text}`
      : text;
    const selectedProvider = llmProvider;
    const selectedProviderLabel = llmProviderOptions.find((option) => option.value === selectedProvider)?.label ?? selectedProvider;

    appendAssistantMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    });
    setAssistantInput("");
    setAssistantPendingTask(null);

    setAssistantBusy(true);
    setAssistantProgress("正在等待 LLM 生成本轮计划。");

    try {
      let context: {
        currentPagePath?: string[];
        currentPageRegistry?: unknown;
        history?: Array<{
          toolCalls: AssistantToolCall[];
        }>;
        lastOperationResult?: unknown;
        backendToolResults?: unknown[];
      } | undefined = pendingTask?.context;
      const operationHistory: Array<{
        toolCalls: AssistantToolCall[];
      }> = [...(context?.history ?? [])];
      let currentPageRegistry: unknown = context?.currentPageRegistry;
      let currentPage: MainTab = mainTab;
      let currentOpenTabs = new Set(openTabs);
      let currentPagePath = context?.currentPagePath ?? (mainTab === "policy"
        ? ["综合查询", "保单信息查询"]
        : mainTab === "calculation_config"
          ? ["理赔配置", "保单理算配置"]
          : mainTab === "claim_registration"
            ? ["理赔处理", "受理立案"]
          : ["综合查询", "案件查询"]);
      let plan: AssistantPlan | null = null;
      let allSteps: string[] = [];
      let lastExecutedPlan: AssistantPlan | null = null;
      let lastExecutionResult: {
        currentPage: string;
        executionResult: unknown;
        runtimeFieldOptions: RuntimeFieldOptions;
        steps: string[];
      } | null = null;
      let executionRoundLimitReached = false;
      let backendToolResults: unknown[] = [...(context?.backendToolResults ?? [])];

      // 复杂配置通常需要页面发现、查询、选择对象、打开编辑器、填写及保存等多个阶段。
      for (let round = 0; round < MAX_ASSISTANT_EXECUTION_ROUNDS; round += 1) {
        const response = await fetch("/api/assistant/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: effectiveText, provider: selectedProvider, context }),
        });

        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as
            | { detail?: string; message?: string }
            | null;
          appendAssistantMessage({
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: errorPayload?.detail ?? `${selectedProviderLabel}当前不可用，请稍后再试。`,
            steps: [`当前模型：${selectedProviderLabel}`, "未启用规则回退"],
          });
          return;
        }

        plan = (await response.json()) as AssistantPlan;
        backendToolResults = plan.backendToolResults ?? backendToolResults;
        lastExecutedPlan = plan;
        setAssistantRecognized(plan.recognized ?? []);
        const thought = plan.thought ?? plan.reply;
        setAssistantProgress(`LLM 思路：${thought}`);
        allSteps = [...allSteps, ...(plan.discoverySteps ?? [])];

        if (plan.toolCalls.length > 0) {
          setAssistantProgress(`LLM 思路：${thought}（正在执行）`);
          const execution = await executeAssistantTools(plan.toolCalls, currentPage, currentOpenTabs, lastExecutionResult?.executionResult);
          lastExecutionResult = execution;
          currentPage = execution.currentPage;
          currentOpenTabs = execution.openTabs;
          allSteps = [...allSteps, ...execution.steps];
          operationHistory.push({
            toolCalls: plan.toolCalls,
          });
          if (plan.discoveryResults && plan.discoveryResults.length > 0) {
            currentPageRegistry = applyRuntimeFieldOptions(
              plan.discoveryResults[plan.discoveryResults.length - 1],
              execution.runtimeFieldOptions,
            );
          }
          if (execution.openedPageId) {
            const openedPageRegistry = await loadAssistantPageRegistry(execution.openedPageId);
            if (openedPageRegistry && typeof openedPageRegistry === "object") {
              currentPageRegistry = applyRuntimeFieldOptions(openedPageRegistry, execution.runtimeFieldOptions);
              const pagePath = (openedPageRegistry as { pagePath?: unknown }).pagePath;
              if (Array.isArray(pagePath) && pagePath.every((item) => typeof item === "string")) {
                currentPagePath = pagePath;
              }
            }
          }
          if (currentPageRegistry && typeof currentPageRegistry === "object") {
            currentPageRegistry = applyRuntimeFieldOptions(currentPageRegistry, execution.runtimeFieldOptions);
          }
        }

        if (plan.userInputRequest) {
          setAssistantPendingTask({
            taskText: effectiveText,
            question: plan.userInputRequest.question,
            requestedFields: plan.userInputRequest.requestedFields,
            context: {
              currentPagePath,
              currentPageRegistry,
              history: operationHistory,
              lastOperationResult: lastExecutionResult?.executionResult,
              backendToolResults,
            },
          });
          break;
        }

        if (plan.decision !== "continue" || plan.toolCalls.length === 0 || !lastExecutionResult) {
          break;
        }

        if (round === MAX_ASSISTANT_EXECUTION_ROUNDS - 1) {
          executionRoundLimitReached = true;
        }

        context = {
          currentPagePath,
          currentPageRegistry,
          history: operationHistory,
          lastOperationResult: lastExecutionResult.executionResult,
          backendToolResults,
        };
      }

      if (!lastExecutedPlan) return;

      setAssistantRecognized([]);

      const lastToolCall = lastExecutedPlan.toolCalls.at(-1);
      const finalOperation = lastExecutionResult?.executionResult as { type?: unknown; success?: unknown } | undefined;
      const resultSummary =
        lastExecutedPlan.userInputRequest
          ? "等待用户补充信息，回复后将继续原任务。"
          : finalOperation?.type === "mutation_result" && finalOperation.success === true
          ? "数据变更已保存并返回成功结果。"
          : executionRoundLimitReached
            ? "已达到本次执行轮次上限，任务尚未确认完成。"
          : lastToolCall?.tool === "click_button" && lastToolCall.args.actionId === "search"
          ? "查询结果已经刷新，等待 Agent 根据结果继续判断。"
          : lastToolCall?.tool === "set_field"
            ? "已更新页面筛选字段并刷新对应结果。"
          : lastToolCall?.tool === "click_list_row_action"
            ? `已执行：${formatToolCall(lastToolCall)}。`
            : lastExecutedPlan.decision === "finish"
              ? "任务已结束。"
              : "已执行当前步骤。";

      appendAssistantMessage({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: lastExecutedPlan.userInputRequest?.question ?? lastExecutedPlan.reply,
        source: `${selectedProviderLabel} 回复`,
        systemNote: resultSummary,
        steps: allSteps,
      });
    } finally {
      setAssistantBusy(false);
      setAssistantProgress(null);
    }
  }

  const totalPolicyPages = Math.max(1, Math.ceil(policyTotal / POLICY_PAGE_SIZE));
  const selectedStatusLabel =
    policyStatusOptions.find((option) => option.value === filters.policyStatus)?.label ?? "全部";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand">healthAgent 承保管理系统</div>
          <nav className="topnav">
            <div className="menu-item active">
              <button className="menu-trigger" onClick={() => { setMenuOpen((value) => !value); setClaimMenuOpen(false); setConfigMenuOpen(false); }}>
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
            </div>
            <div className="menu-item">
              <button className="menu-trigger" onClick={() => { setConfigMenuOpen((value) => !value); setMenuOpen(false); setClaimMenuOpen(false); }}>
                理赔配置 ▾
              </button>
              <div className={`dropdown ${configMenuOpen ? "" : "hidden"}`}>
                <button className="dropdown-item" onClick={() => { openMainTab("calculation_config"); setConfigMenuOpen(false); }}>
                  保单理算配置
                </button>
              </div>
            </div>
            <div className="menu-item">
              <button className="menu-trigger" onClick={() => { setClaimMenuOpen((value) => !value); setMenuOpen(false); setConfigMenuOpen(false); }}>
                理赔处理 ▾
              </button>
              <div className={`dropdown ${claimMenuOpen ? "" : "hidden"}`}>
                <button className="dropdown-item" onClick={() => { openMainTab("claim_registration"); setClaimMenuOpen(false); }}>受理立案</button>
                <button className="dropdown-item" onClick={() => { openMainTab("claim"); setClaimMenuOpen(false); }}>案件查询</button>
              </div>
            </div>
          </nav>
        </div>
        <div className="topbar-right">
          <button
            className={`assistant-top-button ${assistantOpen ? "open" : ""}`}
            type="button"
            onClick={() => setAssistantOpen((value) => !value)}
          >
            智能助手
          </button>
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
                  : "保单理算配置";
            return (
              <div className={`tab ${mainTab === tab ? "active" : ""}`} key={tab}>
                <button className="tab-button" onClick={() => setMainTab(tab)}>{label}</button>
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
                  <button className="secondary-button" onClick={() => setDrawerOpen(false)}>关闭</button>
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
                    />
                  )}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className={`page-section ${openTabs.includes("claim") && mainTab === "claim" ? "" : "hidden"}`}>
          <section className="panel empty-state">
            <h3>案件查询</h3>
            <p>该功能入口已预留，当前阶段暂未接入案件数据与查询条件。</p>
            <p className="muted">后续会在这里承接理赔受理、案件检索、详情查看和理算结果联查。</p>
          </section>
        </section>

        <section className={`page-section ${openTabs.includes("claim_registration") && mainTab === "claim_registration" ? "" : "hidden"}`}>
          <ClaimRegistrationPage ref={claimRegistrationControllerRef} />
        </section>

        <section className={`page-section ${openTabs.includes("calculation_config") && mainTab === "calculation_config" ? "" : "hidden"}`}>
          <CalculationConfigPage ref={calculationConfigControllerRef} />
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
          <button className="assistant-close" type="button" onClick={() => setAssistantOpen(false)}>
            收起
          </button>
        </div>

        <div className="assistant-messages" ref={assistantMessagesRef}>
          {assistantMessages.map((message) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <div className="assistant-message-role">
                {message.role === "assistant" ? (message.source ?? "助手") : "我"}
              </div>
              <div className="assistant-message-content">{message.content}</div>
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
          <button type="button" onClick={() => void handleAssistantSubmit()} disabled={assistantBusy}>
            {assistantBusy ? "执行中..." : "执行"}
          </button>
        </div>
      </section>
    </>
  );
}
