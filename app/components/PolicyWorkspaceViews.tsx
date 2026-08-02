"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CoveragePlan, PolicyDetailView, PolicyInsuredView, PolicyProductView } from "../../src/underwriting/types";

export const INSURED_PAGE_SIZE = 10;

export function formatPolicyStatus(value?: string) {
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

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function throwIfAssistantAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("assistant_execution_aborted", "AbortError");
}

export function Pagination({
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

export function BasicView({ data }: { data: PolicyDetailView }) {
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

export function BenefitsView({ plans, products }: { plans: CoveragePlan[]; products: PolicyProductView[] }) {
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

export function InsuredsView({
  insureds,
  plans,
  selectedPlanId,
  total,
  page,
  setSelectedPlanId,
  setPage,
  onViewLedger,
}: {
  insureds: PolicyInsuredView[];
  plans: CoveragePlan[];
  selectedPlanId: string;
  total: number;
  page: number;
  setSelectedPlanId: (planId: string) => void;
  setPage: (page: number) => void;
  onViewLedger: (item: PolicyInsuredView) => void;
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
                <th>操作</th>
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
                  <td><button type="button" className="action-link" onClick={() => onViewLedger(item)}>查看台账</button></td>
                </tr>
              )) : (
                <tr><td className="config-empty-cell" colSpan={12}>该保障计划下没有被保人。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalPages={totalPages} total={total} onChange={setPage} />
      </div>
    </>
  );
}
