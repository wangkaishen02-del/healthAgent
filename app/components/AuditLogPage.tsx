"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../src/api/client";

type AuditItem = {
  id: string;
  actorUsername: string;
  actorName: string;
  actorRoles: string[];
  method: string;
  path: string;
  action: string;
  description?: string | null;
  resourceType: string;
  resourceId?: string | null;
  caseNo?: string | null;
  outcome: string;
  statusCode: number;
  requestId: string;
  occurredAt: string;
};

export default function AuditLogPage() {
  const [actorKeyword, setActorKeyword] = useState("");
  const [caseNo, setCaseNo] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function load(nextPage = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
      if (actorKeyword.trim()) params.set("actorKeyword", actorKeyword.trim());
      if (caseNo.trim()) params.set("caseNo", caseNo.trim());
      if (action) params.set("action", action);
      if (resourceType.trim()) params.set("resourceType", resourceType.trim());
      const response = await apiFetch(`/api/audit-logs?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as { items?: AuditItem[]; total?: number; message?: string };
      if (!response.ok) throw new Error(result.message ?? "audit_load_failed");
      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(1); }, []);

  return (
    <section className="page-section audit-page">
      <section className="panel query-panel">
        <div className="section-title">操作日志查询</div>
        <form className="query-form" onSubmit={(event) => { event.preventDefault(); void load(1); }}>
          <label><span>用户</span><input className="filter-control" value={actorKeyword} onChange={(event) => setActorKeyword(event.target.value)} placeholder="用户 ID、账号或姓名" /></label>
          <label><span>案件号</span><input className="filter-control" value={caseNo} onChange={(event) => setCaseNo(event.target.value.toUpperCase())} placeholder="例如 CL202607190001" /></label>
          <label><span>关键操作</span><select className="filter-control" value={action} onChange={(event) => setAction(event.target.value)}><option value="">全部操作</option><option value="claim_search">查询案件</option><option value="claim_view">查看案件</option><option value="claim_transition_history_view">查看流转记录</option><option value="api_mutation">业务数据变更</option></select></label>
          <label><span>资源类型</span><input className="filter-control" value={resourceType} onChange={(event) => setResourceType(event.target.value)} placeholder="例如 claim-registrations" /></label>
          <div className="query-actions"><button type="submit" disabled={loading}>查询</button></div>
        </form>
      </section>
      <section className="panel result-panel">
        <div className="panel-title-row"><div className="section-title">操作日志</div><span className="muted">{total} 条</span></div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>案件</th><th>业务对象</th><th>结果</th></tr></thead>
            <tbody>
              {items.map((item) => <tr key={item.id}>
                <td>{new Date(item.occurredAt).toLocaleString("zh-CN")}</td>
                <td><strong>{item.actorName}</strong><br /><span className="muted">{item.actorUsername}</span></td>
                <td><strong>{item.description || item.action}</strong><br /><span className="muted">{item.method} {item.path}</span></td>
                <td>{item.caseNo ?? "-"}</td>
                <td>{item.resourceType}<br /><span className="muted">{item.resourceId ?? "-"}</span></td>
                <td>{item.outcome === "success" ? "成功" : "失败"}（{item.statusCode}）</td>
              </tr>)}
              {!loading && items.length === 0 && <tr><td colSpan={6} className="empty-cell">暂无操作日志</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span className="pagination-info">第 {page} / {totalPages} 页，共 {total} 条</span>
          <button className="page-btn" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>上一页</button>
          <button className="page-btn" disabled={page >= totalPages || loading} onClick={() => void load(page + 1)}>下一页</button>
        </div>
      </section>
    </section>
  );
}
