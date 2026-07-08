"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PolicyFullView, PolicyInsuredView, PolicyListItem, PolicyProductView } from "../src/underwriting/types";

type MainTab = "policy" | "claim";
type DrawerTab = "basic" | "benefits" | "insureds";

const POLICY_PAGE_SIZE = 10;
const INSURED_PAGE_SIZE = 10;

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
  return (
    <>
      <div className="panel-title-row">
        <h3>险种与责任</h3>
        <span className="muted">{products.length} 个险种</span>
      </div>
      <div className="product-list">
        {products.map((product) => (
          <div className="subpanel" key={product.id}>
            <div className="panel-title-row">
              <div>
                <h4>{product.productName}</h4>
                <p className="muted">代码：{product.productCode}</p>
              </div>
              <span className="chip">{formatPolicyStatus(product.productStatus)}</span>
            </div>
            <div className="table-wrapper">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>险种代码</th>
                    <th>险种名称</th>
                    <th>责任代码</th>
                    <th>责任名称</th>
                    <th>顺序</th>
                  </tr>
                </thead>
                <tbody>
                  {product.benefits.map((benefit) => (
                    <tr key={benefit.id}>
                      <td>{product.productCode}</td>
                      <td>{product.productName}</td>
                      <td>{benefit.benefitCode}</td>
                      <td>{benefit.benefitName}</td>
                      <td>{benefit.sequenceNo ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [filters, setFilters] = useState({
    policyNo: "",
    applicantName: "",
    insuredName: "",
    insuredIdNo: "",
    policyStatus: "",
  });
  const [policies, setPolicies] = useState<PolicyListItem[]>([]);
  const [policyPage, setPolicyPage] = useState(1);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("basic");
  const [drawerData, setDrawerData] = useState<PolicyFullView | null>(null);
  const [insuredPage, setInsuredPage] = useState(1);
  const selectRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadPolicies(filters);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setStatusOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  async function loadPolicies(nextFilters: typeof filters) {
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
  }

  async function openPolicyDrawer(policyId: string, tab: DrawerTab) {
    setActivePolicyId(policyId);
    setDrawerTab(tab);
    setInsuredPage(1);
    const response = await fetch(`/api/policies/${policyId}/full-view`);
    const data: PolicyFullView = await response.json();
    setDrawerData(data);
    setDrawerOpen(true);
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
        <div className="topbar-brand">healthAgent 承保管理系统</div>
        <nav className="topnav">
          <div className="menu-item active">
            <button className="menu-trigger" onClick={() => setMenuOpen((value) => !value)}>
              综合查询 ▾
            </button>
            <div className={`dropdown ${menuOpen ? "" : "hidden"}`}>
              <button className="dropdown-item" onClick={() => { setMainTab("policy"); setMenuOpen(false); }}>
                保单信息查询
              </button>
              <button className="dropdown-item" onClick={() => { setMainTab("claim"); setMenuOpen(false); }}>
                案件查询
              </button>
            </div>
          </div>
        </nav>
      </header>

      <main className="workspace">
        <div className="tabs-bar">
          <button className={`tab ${mainTab === "policy" ? "active" : ""}`} onClick={() => setMainTab("policy")}>
            保单信息查询
          </button>
          <button className={`tab ${mainTab === "claim" ? "active" : ""}`} onClick={() => setMainTab("claim")}>
            案件查询
          </button>
        </div>

        <section className={`page-section ${mainTab === "policy" ? "" : "hidden"}`}>
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
                    const next = { policyNo: "", applicantName: "", insuredName: "", insuredIdNo: "", policyStatus: "" };
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

        <section className={`page-section ${mainTab === "claim" ? "" : "hidden"}`}>
          <section className="panel empty-state">
            <h3>案件查询</h3>
            <p>该功能入口已预留，当前阶段暂未接入案件数据与查询条件。</p>
            <p className="muted">后续会在这里承接理赔受理、案件检索、详情查看和理算结果联查。</p>
          </section>
        </section>
      </main>
    </>
  );
}
