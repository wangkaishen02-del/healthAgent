"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import type { ClaimCase, ClaimCaseStatus, ClaimPartySnapshot } from "../../src/claims/types";
import { CLAIM_CASE_STATUSES, CLAIM_STATUS_LABELS } from "../../src/claims/state-machine";
import { apiFetch } from "../../src/api/client";
import AppSelect, { type AppSelectOption } from "./AppSelect";
import ClaimEntryCalculationPage from "./ClaimEntryCalculationPage";

type ClaimFilters = {
  caseNo: string;
  policyNo: string;
  insuredName: string;
  insuredIdNo: string;
  status: "" | ClaimCaseStatus;
  reportDateFrom: string;
  reportDateTo: string;
};

type ClaimPageResult = { total: number; page: number; pageSize: number; items: ClaimCase[] };
type DetailTab = "basic" | "parties" | "event" | "attachments";

const PAGE_SIZE = 10;
const EMPTY_FILTERS: ClaimFilters = { caseNo: "", policyNo: "", insuredName: "", insuredIdNo: "", status: "", reportDateFrom: "", reportDateTo: "" };
const statusLabels: Record<ClaimCaseStatus, string> = CLAIM_STATUS_LABELS;
const statusOptions: AppSelectOption<ClaimFilters["status"]>[] = [{ value: "", label: "全部状态" }, ...CLAIM_CASE_STATUSES.map((status) => ({ value: status, label: CLAIM_STATUS_LABELS[status] }))];
const roleLabels: Record<ClaimPartySnapshot["role"], string> = { insured: "被保人", applicant: "申请人", payee: "领款人" };
const eventTypeLabels = { "1": "疾病", "2": "意外", "9": "其他" } as const;
const reportChannelLabels = { online: "线上报案", phone: "电话报案", counter: "柜面报案", other: "其他" } as const;
const attachmentCategoryLabels = { application: "理赔申请书", identity: "身份证明", medical: "病历资料", invoice: "发票费用清单", bank: "银行卡资料", other: "其他资料" } as const;

function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function ReadonlyItems({ items }: { items: Array<{ label: string; value?: string | number | null }> }) {
  return <div className="kv-grid">{items.map((item) => <div className="kv-item" key={item.label}><span>{item.label}</span><strong>{item.value || "-"}</strong></div>)}</div>;
}

function CaseDetail({ item, tab }: { item: ClaimCase; tab: DetailTab }) {
  if (tab === "basic") return <div className="grid two">
    <section className="subpanel"><h3>案件基本信息</h3><ReadonlyItems items={[
      { label: "案件号", value: item.caseNo }, { label: "保单号", value: item.policyNo }, { label: "案件状态", value: statusLabels[item.status] },
      { label: "报案日期", value: item.reportDate }, { label: "报案渠道", value: reportChannelLabels[item.reportChannel] }, { label: "关联事件号", value: item.event.eventNo },
      { label: "创建时间", value: new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }) }, { label: "更新时间", value: new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false }) },
    ]} /></section>
    <section className="subpanel"><h3>案件备注</h3><p className="claim-readonly-note">{item.remark || "暂无备注"}</p></section>
  </div>;

  if (tab === "parties") return <div className="claim-query-party-list">{item.parties.map((party) => <section className="subpanel" key={party.role}>
    <h3>{roleLabels[party.role]}</h3>
    <ReadonlyItems items={[
      { label: "姓名", value: party.name }, { label: "与被保人关系", value: party.relationToInsured }, { label: "证件号码", value: party.idNo }, { label: "联系电话", value: party.phone },
      { label: "出生日期", value: party.birthDate }, { label: "联系地址", value: party.address },
      ...(party.role === "payee" ? [{ label: "开户银行", value: party.bankName }, { label: "账户名称", value: party.bankAccountName }, { label: "银行账号", value: party.bankAccountNo }] : []),
    ]} />
  </section>)}</div>;

  if (tab === "event") return <section className="subpanel"><h3>关联事件</h3><ReadonlyItems items={[
    { label: "事件号", value: item.event.eventNo }, { label: "事件类型", value: eventTypeLabels[item.event.eventType] }, { label: "发生日期", value: item.event.occurredDate },
    { label: "行政区域", value: item.event.administrativeArea }, { label: "详细地点", value: item.event.detailedAddress }, { label: "就诊医院", value: item.event.hospitalName },
    { label: "诊断", value: item.event.diagnosis }, { label: "事件经过", value: item.event.description },
  ]} /></section>;

  return <section className="subpanel"><div className="panel-title-row"><h3>影像资料</h3><span className="muted">{item.attachments.length} 件</span></div>
    <div className="table-wrapper"><table><thead><tr><th>资料分类</th><th>文件名</th><th>文件类型</th><th>大小</th><th>上传时间</th></tr></thead><tbody>
      {item.attachments.length ? item.attachments.map((attachment) => <tr key={attachment.uploadId}><td>{attachmentCategoryLabels[attachment.category]}</td><td>{attachment.fileName}</td><td>{attachment.mimeType}</td><td>{formatFileSize(attachment.fileSize)}</td><td>{new Date(attachment.uploadedAt).toLocaleString("zh-CN", { hour12: false })}</td></tr>) : <tr><td colSpan={5}>暂无影像资料</td></tr>}
    </tbody></table></div>
  </section>;
}

const ClaimQueryPage = forwardRef<RegisteredPageController>(function ClaimQueryPage(_, assistantRef) {
  const [filters, setFilters] = useState<ClaimFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<ClaimCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<ClaimCase | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("basic");
  const stateRef = useRef({ filters, items });
  stateRef.current = { filters, items };

  async function search(nextFilters = stateRef.current.filters, nextPage = 1) {
    setBusy(true); setError("");
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
    Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const response = await apiFetch(`/api/claim-registrations?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("query_failed");
      const result = await response.json() as ClaimPageResult;
      setItems(result.items); setTotal(result.total); setPage(result.page); setDetail(null);
      stateRef.current = { filters: nextFilters, items: result.items };
      return { type: "claim_search", matchedCaseCount: result.total, page: result.page, items: result.items.slice(0, 20).map((item) => ({ itemId: item.id, caseNo: item.caseNo, policyNo: item.policyNo, insuredName: item.parties.find((party) => party.role === "insured")?.name, status: item.status })) };
    } catch {
      setItems([]); setTotal(0); setError("案件查询失败，请稍后重试。");
      return { type: "operation_error", reason: "claim_query_failed" };
    } finally { setBusy(false); }
  }

  function reset() {
    setFilters(EMPTY_FILTERS); stateRef.current = { ...stateRef.current, filters: EMPTY_FILTERS }; setDetail(null);
    return search(EMPTY_FILTERS, 1);
  }

  function openDetail(item: ClaimCase) {
    setDetail(item); setDetailTab("basic");
    return { type: "detail_view", pageId: "claim_query", caseId: item.id, caseNo: item.caseNo, status: item.status, readonly: true };
  }

  useEffect(() => { void search(EMPTY_FILTERS, 1); }, []);

  useImperativeHandle(assistantRef, () => ({
    async setField(fieldId, value) {
      if (!(fieldId in EMPTY_FILTERS)) return { type: "operation_error", reason: "field_executor_not_bound", fieldId };
      const next = { ...stateRef.current.filters, [fieldId]: fieldId === "caseNo" || fieldId === "policyNo" || fieldId === "insuredIdNo" ? value.toUpperCase() : value } as ClaimFilters;
      setFilters(next); stateRef.current = { ...stateRef.current, filters: next };
      return { type: "field_updated", pageId: "claim_query", fieldId, value: next[fieldId as keyof ClaimFilters] };
    },
    async executeAction(actionId) {
      if (actionId === "search") return search(stateRef.current.filters, 1);
      if (actionId === "reset") return reset();
      if (actionId === "close_detail") { setDetail(null); return { type: "page_action", pageId: "claim_query", actionId }; }
      return { type: "operation_error", reason: "action_executor_not_bound", actionId };
    },
    async executeRowAction(actionId, row) {
      const item = stateRef.current.items[row - 1];
      return actionId === "view_case" && item ? openDetail(item) : { type: "operation_error", reason: "row_action_not_available", row };
    },
    async executeItemAction(actionId, itemId) {
      if (actionId !== "view_case") return { type: "operation_error", reason: "item_action_not_available", itemId };
      let item = stateRef.current.items.find((candidate) => candidate.id === itemId);
      if (!item) {
        const response = await apiFetch(`/api/claim-registrations?id=${encodeURIComponent(itemId)}&page=1&pageSize=1`, { cache: "no-store" });
        if (response.ok) item = ((await response.json()) as ClaimPageResult).items[0];
      }
      return item ? openDetail(item) : { type: "operation_error", reason: "claim_case_not_found", itemId };
    },
    getRuntimeFieldOptions: () => ({ "claim_query.status": statusOptions.map((option) => ({ value: option.value, label: option.label })) }),
    getRuntimeCapabilities() {
      return {
        availableActionIds: stateRef.current.items.length > 0
          ? ["search", "reset", "view_case"]
          : ["search", "reset"],
      };
    },
  }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <>
    <section className="panel query-panel">
      <div className="panel-title-row"><div><div className="section-title">案件查询条件</div><small className="muted">综合查询仅提供检索与查看，不支持新增、修改、提交或撤件。</small></div></div>
      <form className="query-form claim-query-form" onSubmit={(event) => { event.preventDefault(); void search(filters, 1); }}>
        <label><span>案件号</span><input className="filter-control" value={filters.caseNo} onChange={(event) => setFilters((current) => ({ ...current, caseNo: event.target.value.toUpperCase() }))} placeholder="例如 CL202607190001" /></label>
        <label><span>保单号</span><input className="filter-control" value={filters.policyNo} onChange={(event) => setFilters((current) => ({ ...current, policyNo: event.target.value.toUpperCase() }))} placeholder="例如 GI2026000001" /></label>
        <label><span>被保人姓名</span><input className="filter-control" value={filters.insuredName} onChange={(event) => setFilters((current) => ({ ...current, insuredName: event.target.value }))} /></label>
        <label><span>被保人证件号</span><input className="filter-control" value={filters.insuredIdNo} onChange={(event) => setFilters((current) => ({ ...current, insuredIdNo: event.target.value.toUpperCase() }))} /></label>
        <label><span>案件状态</span><AppSelect ariaLabel="案件状态" value={filters.status} options={statusOptions} onChange={(status) => setFilters((current) => ({ ...current, status }))} /></label>
        <label><span>报案日期起</span><input className="filter-control" type="date" value={filters.reportDateFrom} onChange={(event) => setFilters((current) => ({ ...current, reportDateFrom: event.target.value }))} /></label>
        <label><span>报案日期止</span><input className="filter-control" type="date" value={filters.reportDateTo} onChange={(event) => setFilters((current) => ({ ...current, reportDateTo: event.target.value }))} /></label>
        <div className="query-actions"><button type="submit" disabled={busy}>{busy ? "查询中…" : "查询"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void reset()}>重置</button></div>
      </form>
      {error ? <p className="field-error">{error}</p> : null}
    </section>

    <section className="panel result-panel">
      <div className="panel-title-row"><div className="section-title">查询结果</div><span className="muted">{total} 条</span></div>
      <div className="result-table-shell"><div className="table-wrapper result-table-wrapper"><table><thead><tr><th>序号</th><th>案件号</th><th>保单号</th><th>被保人</th><th>证件号</th><th>当前处理人</th><th>报案日期</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
        {items.length ? items.map((item, index) => { const insured = item.parties.find((party) => party.role === "insured"); return <tr key={item.id} className={detail?.id === item.id ? "active-row" : ""}><td>{(page - 1) * PAGE_SIZE + index + 1}</td><td><strong>{item.caseNo}</strong></td><td>{item.policyNo}</td><td>{insured?.name ?? "-"}</td><td>{insured?.idNo ?? "-"}</td><td>{item.currentHandlerName || "-"}</td><td>{item.reportDate}</td><td><span className={`status-badge claim-${item.status}`}>{statusLabels[item.status]}</span></td><td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td><td><button type="button" className="action-link" onClick={() => openDetail(item)}>查看详情</button></td></tr>; }) : <tr><td colSpan={10}>没有找到符合条件的案件。</td></tr>}
      </tbody></table></div>
      <div className="pagination"><span className="pagination-info">第 {page} / {totalPages} 页，共 {total} 条</span><button className="page-btn" disabled={page <= 1 || busy} onClick={() => void search(filters, page - 1)}>上一页</button><button className="page-btn" disabled={page >= totalPages || busy} onClick={() => void search(filters, page + 1)}>下一页</button></div></div>
    </section>

    <div className={`drawer-overlay ${detail ? "open" : ""}`} aria-hidden={!detail}><aside className="drawer-panel claim-query-review-drawer">
      {detail ? <ClaimEntryCalculationPage mode="query" initialCase={detail} onClose={() => setDetail(null)} /> : null}
    </aside></div>
  </>;
});

export default ClaimQueryPage;
