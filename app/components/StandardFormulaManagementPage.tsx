"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import { apiFetch } from "../../src/api/client";
import type { FormulaStep, StandardFormulaView } from "../../src/calculation/automation-types";

type EditorMode = "create" | "view" | "edit";
type FormulaDraft = {
  id?: number;
  formulaCode?: string;
  formulaName: string;
  matchExpression: string;
  tags: string[];
  steps: FormulaStep[];
  referenceCount: number;
};

const emptyDraft = (): FormulaDraft => ({
  formulaName: "",
  matchExpression: "",
  tags: [],
  steps: [{ id: crypto.randomUUID(), name: "给付金额", expression: "", result: true }],
  referenceCount: 0,
});

const StandardFormulaManagementPage = forwardRef<RegisteredPageController>(function StandardFormulaManagementPage(_, assistantRef) {
  const [items, setItems] = useState<StandardFormulaView[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [draft, setDraft] = useState<FormulaDraft>(emptyDraft);
  const [tagInput, setTagInput] = useState("");

  async function load() {
    setLoading(true);
    const response = await apiFetch("/api/automatic-calculation/standard-formulas", { cache: "no-store" });
    const result = await response.json() as StandardFormulaView[] | { message?: string };
    setLoading(false);
    if (!response.ok || !Array.isArray(result)) {
      setMessage(`标准公式加载失败：${Array.isArray(result) ? "请稍后重试" : result.message ?? "请稍后重试"}`);
      return;
    }
    setItems(result.map((item) => ({
      ...item,
      tags: Array.isArray(item.tags) ? item.tags : [],
      steps: Array.isArray(item.steps) ? item.steps : [],
      referenceCount: Number.isFinite(item.referenceCount) ? item.referenceCount : 0,
      updatedAt: item.updatedAt ?? item.createdAt,
    })));
    setMessage("");
  }

  useEffect(() => { void load(); }, []);

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => [item.formulaCode, item.formulaName, ...(item.tags ?? [])].some((value) => value.toLowerCase().includes(normalized)));
  }, [items, keyword]);

  function openItem(item: StandardFormulaView, nextMode: "view" | "edit") {
    setDraft({
      id: item.id,
      formulaCode: item.formulaCode,
      formulaName: item.formulaName,
      matchExpression: item.matchExpression,
      tags: [...(item.tags ?? [])],
      steps: (item.steps ?? []).map((step) => ({ ...step, ledgerTarget: step.ledgerTarget ? { ...step.ledgerTarget } : undefined })),
      referenceCount: item.referenceCount ?? 0,
    });
    setMode(nextMode);
    setTagInput("");
    setMessage("");
  }

  function startCreate() {
    setDraft(emptyDraft());
    setMode("create");
    setTagInput("");
    setMessage("");
  }

  function addTag() {
    const tag = tagInput.trim().slice(0, 30);
    if (!tag || draft.tags.includes(tag)) return;
    setDraft((current) => ({ ...current, tags: [...current.tags, tag].slice(0, 20) }));
    setTagInput("");
  }

  function updateStep(index: number, changes: Partial<FormulaStep>) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...changes } : step),
    }));
  }

  function selectResultStep(index: number) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => ({ ...step, result: stepIndex === index })),
    }));
  }

  function addStep() {
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, { id: crypto.randomUUID(), name: "", expression: "", result: false }],
    }));
  }

  function removeStep(index: number) {
    setDraft((current) => {
      if (current.steps.length <= 1) return current;
      const removedResult = current.steps[index]?.result;
      const steps = current.steps.filter((_, stepIndex) => stepIndex !== index);
      return { ...current, steps: removedResult ? steps.map((step, stepIndex) => ({ ...step, result: stepIndex === steps.length - 1 })) : steps };
    });
  }

  async function save() {
    if (!draft.formulaName.trim() || !draft.matchExpression.trim() || draft.steps.some((step) => !step.name.trim() || !step.expression.trim())) {
      setMessage("请完整填写公式名称、匹配条件以及每个公式步骤。");
      return;
    }
    setLoading(true);
    const response = await apiFetch("/api/automatic-calculation/standard-formulas", {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const result = await response.json() as StandardFormulaView & { message?: string };
    setLoading(false);
    if (!response.ok) {
      setMessage(`标准公式保存失败：${result.message ?? "请检查公式内容"}`);
      return;
    }
    setItems((current) => mode === "create" ? [result, ...current] : current.map((item) => item.id === result.id ? result : item));
    setDraft({ ...draft, ...result, tags: [...result.tags], steps: result.steps.map((step) => ({ ...step })) });
    setMode("view");
    setMessage(result.referenceCount ? `标准公式已保存，并同步更新 ${result.referenceCount} 个引用责任。` : "标准公式已保存。");
  }

  async function remove(item: StandardFormulaView) {
    const warning = item.referenceCount
      ? `标准公式 ${item.formulaCode} 正被 ${item.referenceCount} 个责任引用。删除后这些责任将解除引用，但保留当前公式副本。是否继续？`
      : `确认删除标准公式 ${item.formulaCode}？`;
    if (!globalThis.confirm(warning)) return;
    setLoading(true);
    const response = await apiFetch(`/api/automatic-calculation/standard-formulas?id=${item.id}`, { method: "DELETE" });
    const result = await response.json() as { success?: boolean; message?: string; unlinkedReferenceCount?: number };
    setLoading(false);
    if (!response.ok) {
      setMessage(`标准公式删除失败：${result.message ?? "请稍后重试"}`);
      return;
    }
    setItems((current) => current.filter((formula) => formula.id !== item.id));
    if (draft.id === item.id) setMode(null);
    setMessage(result.unlinkedReferenceCount ? `标准公式已删除，并解除 ${result.unlinkedReferenceCount} 个责任的引用关系。` : "标准公式已删除。");
  }

  useImperativeHandle(assistantRef, () => ({
    async setField(fieldId, value) {
      if (fieldId === "keyword") { setKeyword(value); return { type: "field_updated", pageId: "standard_formula_management", fieldId, value }; }
      return { type: "operation_error", reason: "field_not_supported", fieldId };
    },
    async executeAction(actionId) {
      if (actionId === "refresh") { await load(); return { type: "page_action", pageId: "standard_formula_management", actionId }; }
      if (actionId === "new_formula") { startCreate(); return { type: "page_action", pageId: "standard_formula_management", actionId }; }
      if (actionId === "reset") { setKeyword(""); setMode(null); return { type: "page_action", pageId: "standard_formula_management", actionId }; }
      return { type: "operation_error", reason: "action_not_supported", actionId };
    },
    async executeRowAction(actionId, row) {
      const item = filteredItems[row - 1];
      if (!item) return { type: "operation_error", reason: "row_not_found", row };
      if (actionId === "view") { openItem(item, "view"); return { type: "detail_view", pageId: "standard_formula_management", itemId: item.id }; }
      if (actionId === "edit") { openItem(item, "edit"); return { type: "edit_view", pageId: "standard_formula_management", itemId: item.id }; }
      return { type: "operation_error", reason: "row_action_not_supported", actionId };
    },
    getRuntimeFieldOptions() { return {}; },
  }), [filteredItems]);

  const readOnly = mode === "view";
  return (
    <div className="standard-formula-page">
      <section className="panel standard-formula-header">
        <div><div className="section-title">标准公式管理</div><p>统一维护可复用的责任理算公式。编辑会同步到仍在引用该公式的责任。</p></div>
        <div className="page-header-actions"><button type="button" onClick={() => void load()} disabled={loading}>刷新</button><button type="button" onClick={startCreate} disabled={loading}>新增标准公式</button></div>
      </section>
      <section className="panel standard-formula-list-panel">
        <div className="standard-formula-toolbar"><label><span>公式编号 / 名称 / 标签</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入关键词筛选" /></label><span className="muted">共 {filteredItems.length} 条</span></div>
        {message ? <div className={`config-message ${message.includes("已") ? "success" : ""}`}>{message}</div> : null}
        <div className="table-wrapper standard-formula-table"><table><thead><tr><th>公式编号</th><th>公式名称</th><th>标签</th><th>步骤</th><th>引用责任</th><th>更新时间</th><th className="actions-col">操作</th></tr></thead><tbody>
          {filteredItems.map((item) => <tr key={item.id}><td><code>{item.formulaCode}</code></td><td><strong>{item.formulaName}</strong></td><td><div className="standard-formula-tags">{item.tags?.length ? item.tags.map((tag) => <span key={tag}>{tag}</span>) : <span className="muted">未设置</span>}</div></td><td>{(item.steps?.length ?? 0) + 1} 步</td><td>{item.referenceCount ?? 0}</td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</td><td className="actions-cell"><button type="button" className="action-link" onClick={() => openItem(item, "view")}>查看</button><button type="button" className="action-link" onClick={() => openItem(item, "edit")}>编辑</button><button type="button" className="danger-link" onClick={() => void remove(item)}>删除</button></td></tr>)}
          {!loading && !filteredItems.length ? <tr><td colSpan={7} className="config-empty-cell">暂无标准公式，可点击“新增标准公式”创建。</td></tr> : null}
        </tbody></table></div>
      </section>

      {mode ? <section className="panel standard-formula-editor">
        <div className="panel-title-row"><div><div className="section-title">{mode === "create" ? "新增标准公式" : mode === "edit" ? "编辑标准公式" : "查看标准公式"}</div>{draft.formulaCode ? <small className="muted">公式编号：{draft.formulaCode} · 当前引用 {draft.referenceCount} 个责任</small> : null}</div><div className="page-header-actions">{readOnly ? <button type="button" onClick={() => setMode("edit")}>编辑</button> : <button type="button" onClick={() => void save()} disabled={loading}>{loading ? "保存中..." : "保存标准公式"}</button>}<button type="button" className="secondary-button" onClick={() => setMode(null)}>关闭</button></div></div>
        <fieldset disabled={readOnly || loading} className="standard-formula-fieldset">
          <div className="standard-formula-basic-fields"><label><span>公式名称</span><input value={draft.formulaName} onChange={(event) => setDraft((current) => ({ ...current, formulaName: event.target.value }))} placeholder="例如 标准住院医疗给付公式" /></label><label><span>自动匹配条件</span><textarea value={draft.matchExpression} onChange={(event) => setDraft((current) => ({ ...current, matchExpression: event.target.value }))} placeholder="例如 医疗总费用 > 0" /></label></div>
          <div className="standard-formula-tag-editor"><strong>自定义标签</strong><div className="standard-formula-tags">{draft.tags.map((tag) => <span key={tag}>{tag}<button type="button" aria-label={`删除标签${tag}`} onClick={() => setDraft((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}>×</button></span>)}</div><div><input value={tagInput} maxLength={30} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="例如 住院、医疗险、年度限额" /><button type="button" onClick={addTag}>增加标签</button></div></div>
          <div className="panel-title-row standard-formula-step-heading"><div><strong>公式步骤</strong><small className="muted">第 1 步固定为自动匹配条件，下面从第 2 步开始维护计算过程。</small></div><button type="button" onClick={addStep}>新增步骤</button></div>
          <div className="standard-formula-step-list">{draft.steps.map((step, index) => <div className="standard-formula-step-card" key={step.id}><strong>第 {index + 2} 步</strong><label><span>步骤名称</span><input value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} /></label><label className="expression"><span>公式表达式</span><textarea value={step.expression} onChange={(event) => updateStep(index, { expression: event.target.value })} /></label><label><span>累计台账</span><select value={step.ledgerTarget?.code ?? ""} onChange={(event) => { const code = event.target.value; updateStep(index, { ledgerTarget: code ? { code, name: code === "annual_deductible" ? "累计免赔额" : "累计给付金额" } : undefined }); }}><option value="">不累计</option><option value="annual_deductible">累计免赔额</option><option value="annual_payment">累计给付金额</option></select></label><label className="standard-formula-result"><input type="radio" name="standard-formula-result" checked={step.result} onChange={() => selectResultStep(index)} />公式结果</label><button type="button" className="danger-link" disabled={draft.steps.length <= 1} onClick={() => removeStep(index)}>删除</button></div>)}</div>
        </fieldset>
      </section> : null}
    </div>
  );
});

export default StandardFormulaManagementPage;
