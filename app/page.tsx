"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatToolCall, type AssistantPlan, type AssistantToolCall } from "../src/assistant/policy-query-assistant";
import type { PolicyFullView, PolicyInsuredView, PolicyListItem, PolicyProductView } from "../src/underwriting/types";

type MainTab = "policy" | "claim";
type DrawerTab = "basic" | "benefits" | "insureds";
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
  steps?: string[];
};

const POLICY_PAGE_SIZE = 10;
const INSURED_PAGE_SIZE = 10;
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
  return (
    <div className="pagination">
      <span className="pagination-info">
        第 {currentPage} / {totalPages} 页，共 {total} 条
      </span>
      <button className="page-btn" disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)}>
        上一页
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
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

function BasicView({ data }: { data: PolicyFullView }) {
  const summary = [
    { label: "险种数", value: data.products.length },
    { label: "责任数", value: data.products.reduce((sum, item) => sum + item.benefits.length, 0) },
    { label: "被保人数", value: data.insureds.length },
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

function BenefitsView({ products }: { products: PolicyProductView[] }) {
  const benefits = products.flatMap((product) =>
    product.benefits.map((benefit) => ({ product, benefit })),
  );
  let rowNumber = 0;

  return (
    <>
      <div className="panel-title-row">
        <h3>险种与责任</h3>
        <span className="muted">{products.length} 个险种，{benefits.length} 项责任</span>
      </div>
      <div className="detail-table-shell">
        <div className="table-wrapper detail-table-wrapper benefits-table-wrapper">
          <table className="compact-table">
            <thead>
              <tr>
                <th className="index-col">序号</th>
                <th>险种代码</th>
                <th>险种名称</th>
                <th>责任代码</th>
                <th>责任名称</th>
                <th>顺序</th>
              </tr>
            </thead>
            <tbody>
              {products.flatMap((product) =>
                product.benefits.map((benefit, benefitIndex) => {
                  rowNumber += 1;
                  return (
                    <tr key={`${product.id}-${benefit.id}`}>
                      <td>{rowNumber}</td>
                      {benefitIndex === 0 && <td rowSpan={product.benefits.length}>{product.productCode}</td>}
                      {benefitIndex === 0 && <td rowSpan={product.benefits.length}>{product.productName}</td>}
                      <td>{benefit.benefitCode}</td>
                      <td>{benefit.benefitName}</td>
                      <td>{benefit.sequenceNo ?? "-"}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function InsuredsView({
  insureds,
  page,
  setPage,
}: {
  insureds: PolicyInsuredView[];
  page: number;
  setPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(insureds.length / INSURED_PAGE_SIZE));
  const start = (page - 1) * INSURED_PAGE_SIZE;
  const pageItems = insureds.slice(start, start + INSURED_PAGE_SIZE);

  return (
    <>
      <div className="panel-title-row">
        <h3>被保人清单</h3>
        <span className="muted">{insureds.length} 人</span>
      </div>
      <div className="detail-table-shell">
        <div className="table-wrapper detail-table-wrapper">
          <table>
            <thead>
              <tr>
                <th className="index-col">序号</th>
                <th>被保人编号</th>
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
              {pageItems.map((item, index) => (
                <tr key={item.id}>
                  <td>{start + index + 1}</td>
                  <td>{item.insuredPerson.insuredNo}</td>
                  <td>{item.insuredPerson.name}</td>
                  <td>{formatGender(item.insuredPerson.gender)}</td>
                  <td>{item.insuredPerson.birthDate ?? "-"}</td>
                  <td>{item.insuredPerson.phone ?? "-"}</td>
                  <td>{item.insuredPerson.idNo ?? "-"}</td>
                  <td>{formatInsuredRole(item.insuredRole)}</td>
                  <td>{item.joinDate ?? "-"}</td>
                  <td>{formatDateRange(item.effectiveDate, item.expiryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalPages={totalPages} total={insureds.length} onChange={setPage} />
      </div>
    </>
  );
}

export default function Page() {
  const [mainTab, setMainTab] = useState<MainTab>("policy");
  const [openTabs, setOpenTabs] = useState<MainTab[]>(["policy"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [filters, setFilters] = useState<PolicyFilters>(EMPTY_POLICY_FILTERS);
  const [policies, setPolicies] = useState<PolicyListItem[]>([]);
  const [policyPage, setPolicyPage] = useState(1);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("basic");
  const [drawerData, setDrawerData] = useState<PolicyFullView | null>(null);
  const [insuredPage, setInsuredPage] = useState(1);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
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
  const selectRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<PolicyFilters>(EMPTY_POLICY_FILTERS);

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
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setStatusOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  async function loadPolicies(nextFilters: PolicyFilters) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const response = await fetch(`/api/policies?${params.toString()}`);
    const data: { items: PolicyListItem[] } = await response.json();
    setPolicies(data.items);
    setPolicyPage(1);
    setActivePolicyId(null);
    setDrawerOpen(false);
    setDrawerData(null);
    return data.items;
  }

  async function openPolicyDrawer(policyId: string, tab: DrawerTab) {
    setActivePolicyId(policyId);
    setDrawerTab(tab);
    setInsuredPage(1);
    const response = await fetch(`/api/policies/${policyId}/full-view`);
    const data: PolicyFullView = await response.json();
    setDrawerData(data);
    setDrawerOpen(true);
    return data;
  }

  async function loadAssistantPageRegistry(pageId: string) {
    const response = await fetch(`/api/assistant/registry?resource=page&pageId=${encodeURIComponent(pageId)}`);
    const data = (await response.json()) as { page?: unknown };
    return data.page;
  }

  function appendAssistantMessage(message: AssistantMessage) {
    setAssistantMessages((current) => [...current, message]);
  }

  async function executeAssistantTools(toolCalls: AssistantToolCall[], initialTab: MainTab = mainTab) {
    const nextFilters: PolicyFilters = { ...filtersRef.current };
    let currentPolicies = policies;
    let executionTab = initialTab;
    let lastOperationResult: unknown = null;
    let openedPageId: string | null = null;
    const steps: string[] = [];

    for (const toolCall of toolCalls) {
      // 页面动作有页面前置条件：即使 LLM 省略了 open_page，也不能在错误页面上执行。
      if (toolCall.tool !== "open_page" && toolCall.args.pageId === "policy_query" && executionTab !== "policy") {
        openMainTab("policy");
        executionTab = "policy";
        steps.push("打开保单信息查询页");
        await delay(120);
      }

      if (toolCall.tool === "open_page") {
        const targetTab = toolCall.args.pageId === "policy_query" ? "policy" : "claim";
        if (executionTab === targetTab) {
          continue;
        }
        steps.push(formatToolCall(toolCall));
        openMainTab(targetTab);
        executionTab = targetTab;
        await delay(120);
        continue;
      }

      steps.push(formatToolCall(toolCall));

      if (toolCall.tool === "click_button" && toolCall.args.actionId === "reset") {
        Object.assign(nextFilters, EMPTY_POLICY_FILTERS);
        setFilters({ ...nextFilters });
        setPolicyPage(1);
        setActivePolicyId(null);
        setDrawerOpen(false);
        setDrawerData(null);
        await delay(160);
        continue;
      }

      if (toolCall.tool === "set_field") {
        nextFilters[toolCall.args.fieldId] = toolCall.args.value;
        setFilters({ ...nextFilters });
        await delay(180);
        continue;
      }

      if (toolCall.tool === "click_button" && toolCall.args.actionId === "search") {
        setFilters({ ...nextFilters });
        currentPolicies = await loadPolicies(nextFilters);
        lastOperationResult = {
          type: "policy_search",
          matchedPolicyCount: currentPolicies.length,
          policies: currentPolicies.slice(0, 5).map((policy) => ({
            policyId: policy.id,
            policyNo: policy.policyNo,
            policyName: policy.policyName,
            applicantName: policy.applicantName,
            insuredCount: policy.insuredCount,
          })),
        };
        await delay(220);
        continue;
      }

      if (toolCall.tool === "click_list_row_action") {
        const selectedPolicy = currentPolicies[toolCall.args.row - 1];
        if (selectedPolicy) {
          const drawerTabMap = {
            view_detail: "basic",
            view_benefits: "benefits",
            view_insureds: "insureds",
          } as const;
          const drawerData = await openPolicyDrawer(selectedPolicy.id, drawerTabMap[toolCall.args.actionId]);
          openedPageId = "policy_detail";
          lastOperationResult = {
            type: "open_policy_drawer",
            policyId: selectedPolicy.id,
            tab: toolCall.args.actionId,
            policyNo: drawerData.policy.policyNo,
            policyName: drawerData.policy.policyName,
            insuredCount: drawerData.insureds.length,
            insureds: drawerData.insureds.slice(0, 5).map((item) => ({
              insuredNo: item.insuredPerson.insuredNo,
              name: item.insuredPerson.name,
              idNo: item.insuredPerson.idNo,
            })),
          };
          await delay(220);
        } else {
          steps.push("查询结果为空，暂时没有可打开的保单");
        }
      }
    }

    return {
      steps,
      currentPage: executionTab,
      openedPageId,
      executionResult: lastOperationResult ?? {
        executedActions: toolCalls.map(formatToolCall),
      },
    };
  }

  async function handleAssistantSubmit() {
    const text = assistantInput.trim();
    if (!text || assistantBusy) return;

    appendAssistantMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    });
    setAssistantInput("");

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
      } | undefined;
      const operationHistory: Array<{
        toolCalls: AssistantToolCall[];
      }> = [];
      let currentPageRegistry: unknown = undefined;
      let currentPage: MainTab = mainTab;
      let currentPagePath = mainTab === "policy" ? ["综合查询", "保单信息查询"] : ["综合查询", "案件查询"];
      let plan: AssistantPlan | null = null;
      let allSteps: string[] = [];
      let lastExecutedPlan: AssistantPlan | null = null;
      let lastExecutionResult: { currentPage: string; executionResult: unknown; steps: string[] } | null = null;

      // 每次最多进行4个“规划→执行→观察”阶段，避免模型异常时无限循环。
      for (let round = 0; round < 4; round += 1) {
        const response = await fetch("/api/assistant/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, context }),
        });

        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as
            | { detail?: string; message?: string }
            | null;
          appendAssistantMessage({
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: errorPayload?.detail ?? "本地模型当前不可用，请稍后再试。",
            steps: ["当前模式：仅使用本地 LLM", "未启用规则回退"],
          });
          return;
        }

        plan = (await response.json()) as AssistantPlan;
        lastExecutedPlan = plan;
        setAssistantRecognized(plan.recognized ?? []);
        const thought = plan.thought ?? plan.reply;
        setAssistantProgress(`LLM 思路：${thought}`);
        allSteps = [...allSteps, ...(plan.discoverySteps ?? [])];

        if (plan.toolCalls.length > 0) {
          setAssistantProgress(`LLM 思路：${thought}（正在执行）`);
          const execution = await executeAssistantTools(plan.toolCalls, currentPage);
          lastExecutionResult = execution;
          currentPage = execution.currentPage;
          allSteps = [...allSteps, ...execution.steps];
          operationHistory.push({
            toolCalls: plan.toolCalls,
          });
          if (plan.discoveryResults && plan.discoveryResults.length > 0) {
            currentPageRegistry = plan.discoveryResults[plan.discoveryResults.length - 1];
          }
          if (execution.openedPageId) {
            const openedPageRegistry = await loadAssistantPageRegistry(execution.openedPageId);
            if (openedPageRegistry && typeof openedPageRegistry === "object") {
              currentPageRegistry = openedPageRegistry;
              const pagePath = (openedPageRegistry as { pagePath?: unknown }).pagePath;
              if (Array.isArray(pagePath) && pagePath.every((item) => typeof item === "string")) {
                currentPagePath = pagePath;
              }
            }
          }
        }

        if (plan.decision !== "continue" || plan.toolCalls.length === 0 || !lastExecutionResult) {
          break;
        }

        context = {
          currentPagePath,
          currentPageRegistry,
          history: operationHistory,
          lastOperationResult: lastExecutionResult.executionResult,
        };
      }

      if (!lastExecutedPlan) return;

      setAssistantRecognized([]);

      const lastToolCall = lastExecutedPlan.toolCalls.at(-1);
      const resultSummary =
        lastToolCall?.tool === "click_button" && lastToolCall.args.actionId === "search"
          ? "查询结果已经刷新，等待 Agent 根据结果继续判断。"
          : lastToolCall?.tool === "click_list_row_action"
            ? "已打开对应的被保人信息。"
            : lastExecutedPlan.decision === "finish"
              ? "任务已结束。"
              : "已执行当前步骤。";

      appendAssistantMessage({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: `${lastExecutedPlan.reply}${resultSummary}（由本地模型 Agent 生成执行计划）`,
        steps: allSteps,
      });
    } finally {
      setAssistantBusy(false);
      setAssistantProgress(null);
    }
  }

  const pagedPolicies = useMemo(() => {
    const start = (policyPage - 1) * POLICY_PAGE_SIZE;
    return policies.slice(start, start + POLICY_PAGE_SIZE);
  }, [policies, policyPage]);

  const totalPolicyPages = Math.max(1, Math.ceil(policies.length / POLICY_PAGE_SIZE));
  const selectedStatusLabel =
    policyStatusOptions.find((option) => option.value === filters.policyStatus)?.label ?? "全部";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand">healthAgent 承保管理系统</div>
          <nav className="topnav">
            <div className="menu-item active">
              <button className="menu-trigger" onClick={() => setMenuOpen((value) => !value)}>
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
            <button className={`menu-link ${mainTab === "claim" ? "active" : ""}`} onClick={() => openMainTab("claim")}>
              理赔处理
            </button>
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
            const label = tab === "policy" ? "保单信息查询" : "案件查询";
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
              <span className="muted">{policies.length} 条</span>
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
                    {pagedPolicies.length > 0 ? (
                      pagedPolicies.map((item, index) => (
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
              <Pagination currentPage={policyPage} totalPages={totalPolicyPages} total={policies.length} onChange={(page) => { setPolicyPage(page); setActivePolicyId(null); }} />
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
                <div className="drawer-header-actions">
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
                  <button className={`detail-tab ${drawerTab === "insureds" ? "active" : ""}`} onClick={() => { setDrawerTab("insureds"); setInsuredPage(1); }}>被保人信息</button>
                </div>
                <div className="drawer-content">
                  {drawerData && drawerTab === "basic" && <BasicView data={drawerData} />}
                  {drawerData && drawerTab === "benefits" && <BenefitsView products={drawerData.products} />}
                  {drawerData && drawerTab === "insureds" && (
                    <InsuredsView insureds={drawerData.insureds} page={insuredPage} setPage={setInsuredPage} />
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
      </main>

      <section className={`assistant-panel ${assistantOpen ? "open" : ""}`} aria-hidden={!assistantOpen}>
        <div className="assistant-panel-header">
          <div>
            <div className="assistant-title">智能助手</div>
            <div className="assistant-subtitle">输入自然语言，我会理解后自动操作页面</div>
          </div>
          <button className="assistant-close" type="button" onClick={() => setAssistantOpen(false)}>
            收起
          </button>
        </div>

        <div className="assistant-messages">
          {assistantMessages.map((message) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <div className="assistant-message-role">
                {message.role === "assistant" ? "助手" : "我"}
              </div>
              <div className="assistant-message-content">{message.content}</div>
              {message.steps && message.steps.length > 0 ? (
                <ul className="assistant-steps">
                  {message.steps.map((step, index) => (
                    <li key={`${message.id}-step-${index}`}>{step}</li>
                  ))}
                </ul>
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
            placeholder="例如：查张三有哪些保单"
            value={assistantInput}
            onChange={(e) => setAssistantInput(e.target.value)}
          />
          <button type="button" onClick={() => void handleAssistantSubmit()} disabled={assistantBusy}>
            {assistantBusy ? "执行中..." : "执行"}
          </button>
        </div>
      </section>
    </>
  );
}
