"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CalculationConfigCatalog,
  CalculationConfigTarget,
  CalculationParameter,
  CalculationParameterDefinition,
  CalculationParameterScope,
  CalculationParameterValueType,
  Policy,
} from "../../src/underwriting/types";

type Option<T extends string> = { value: T; label: string };
type ConfigTarget = { scope: CalculationParameterScope; target: CalculationConfigTarget };
type HierarchyRow = ConfigTarget & { level: number; parentName?: string };

const scopeLabels: Record<CalculationParameterScope, string> = {
  policy: "保单",
  plan: "保障计划",
  product: "险种",
  benefit: "责任",
};

const valueTypeOptions: Option<CalculationParameterValueType>[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数值" },
  { value: "percentage", label: "百分比" },
  { value: "amount", label: "金额" },
  { value: "boolean", label: "是/否" },
];

const emptyCatalog: CalculationConfigCatalog = { policy: [], plan: [], product: [], benefit: [] };

type EditorState = {
  id?: string;
  definitionCode: string;
  parameterValue: string;
  description: string;
  enabled: boolean;
};

const emptyEditor: EditorState = {
  definitionCode: "",
  parameterValue: "",
  description: "",
  enabled: true,
};

function CustomDropdown<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | "";
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, []);

  return (
    <div className="config-select" ref={ref}>
      <button type="button" className="config-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? "请选择"}</span>
        <span className="select-arrow">▾</span>
      </button>
      <div className={`config-select-menu ${open ? "" : "hidden"}`} role="listbox">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={option.value === value ? "active" : ""}
            onClick={() => { onChange(option.value); setOpen(false); }}
          >
            <span>{option.label}</span>
          </button>
        ))}
        {options.length === 0 ? <div className="config-select-empty">暂无可选参数</div> : null}
      </div>
    </div>
  );
}

function formatPolicyStatus(status: Policy["policyStatus"]) {
  return status === "enabled" ? "启用" : "停用";
}

function valueTypeLabel(value: CalculationParameterValueType) {
  return valueTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export default function CalculationConfigPage() {
  const [catalog, setCatalog] = useState<CalculationConfigCatalog>(emptyCatalog);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [items, setItems] = useState<CalculationParameter[]>([]);
  const [definitions, setDefinitions] = useState<CalculationParameterDefinition[]>([]);
  const [policyKeyword, setPolicyKeyword] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/calculation-parameters", { cache: "no-store" });
      const data = await response.json() as {
        catalog: CalculationConfigCatalog;
        policies: Policy[];
        items: CalculationParameter[];
        definitions: CalculationParameterDefinition[];
      };
      setCatalog(data.catalog);
      setPolicies(data.policies);
      setItems(data.items);
      setDefinitions(data.definitions);
    })();
  }, []);

  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? null;

  const hierarchyRows = useMemo<HierarchyRow[]>(() => {
    if (!selectedPolicyId) return [];
    const rows: HierarchyRow[] = [];
    const policyTarget = catalog.policy.find((target) => target.id === selectedPolicyId);
    if (policyTarget) rows.push({ scope: "policy", target: policyTarget, level: 0 });

    catalog.plan.filter((plan) => plan.policyId === selectedPolicyId).forEach((plan) => {
      rows.push({ scope: "plan", target: plan, level: 1, parentName: policyTarget?.name });
      catalog.product.filter((product) => product.planId === plan.id).forEach((product) => {
        rows.push({ scope: "product", target: product, level: 2, parentName: plan.name });
        catalog.benefit.filter((benefit) => benefit.productId === product.id).forEach((benefit) => {
          rows.push({ scope: "benefit", target: benefit, level: 3, parentName: product.name });
        });
      });
    });
    return rows;
  }, [catalog, selectedPolicyId]);

  const visibleParameters = configTarget
    ? items.filter((item) => item.scope === configTarget.scope && item.targetId === configTarget.target.id)
    : [];
  const selectedDefinition = definitions.find((definition) => definition.parameterCode === editor.definitionCode);
  const definitionOptions: Option<string>[] = configTarget
    ? definitions
      .filter((definition) => definition.applicableScopes.includes(configTarget.scope))
      .filter((definition) => definition.parameterCode === editor.definitionCode || !visibleParameters.some((item) => item.parameterCode === definition.parameterCode))
      .map((definition) => ({ value: definition.parameterCode, label: definition.parameterName }))
    : [];

  function searchPolicies() {
    const keyword = policyKeyword.trim().toLowerCase();
    if (!keyword) {
      setMessage("请输入完整保单号。");
      return;
    }
    const matchedPolicy = policies.find((policy) => policy.policyNo.toLowerCase() === keyword);
    setSelectedPolicyId(matchedPolicy?.id ?? null);
    setSearched(true);
    setConfigTarget(null);
    setMessage(matchedPolicy ? "" : "未查询到该保单。");
  }

  function openConfiguration(row: ConfigTarget) {
    setConfigTarget(row);
    setEditorOpen(false);
    setPendingDeleteId(null);
    setMessage("");
  }

  function startCreate() {
    if (!configTarget) return;
    const firstDefinition = definitions.find((definition) =>
      definition.applicableScopes.includes(configTarget.scope)
      && !visibleParameters.some((item) => item.parameterCode === definition.parameterCode),
    );
    if (!firstDefinition) {
      setMessage("当前对象的可选参数均已配置。");
      return;
    }
    setEditor({
      ...emptyEditor,
      definitionCode: firstDefinition.parameterCode,
      parameterValue: firstDefinition.valueType === "boolean" ? "true" : "",
    });
    setEditorOpen(true);
    setPendingDeleteId(null);
    setMessage("");
  }

  function startEdit(item: CalculationParameter) {
    setEditor({
      id: item.id,
      definitionCode: item.parameterCode,
      parameterValue: item.parameterValue,
      description: item.description ?? "",
      enabled: item.enabled,
    });
    setEditorOpen(true);
    setPendingDeleteId(null);
    setMessage("");
  }

  async function saveParameter() {
    if (!configTarget || !editor.definitionCode || !editor.parameterValue.trim()) {
      setMessage("请选择参数名称并填写参数值。");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/calculation-parameters", {
      method: editor.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editor, scope: configTarget.scope, targetId: configTarget.target.id }),
    });
    const result = await response.json() as CalculationParameter & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.message === "parameter_code_exists" ? "当前对象下已存在相同参数编码。" : "保存失败，请检查输入。");
      return;
    }
    setItems((current) => editor.id
      ? current.map((item) => item.id === result.id ? result : item)
      : [...current, result]);
    setEditorOpen(false);
    setMessage("参数已保存。");
  }

  async function removeParameter(id: string) {
    setBusy(true);
    const response = await fetch(`/api/calculation-parameters?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setMessage("删除失败，请稍后重试。");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
    setPendingDeleteId(null);
    if (editor.id === id) setEditorOpen(false);
    setMessage("参数已删除。");
  }

  if (configTarget) {
    return (
      <div className="calculation-config-page">
        <section className="panel config-page-header">
          <button type="button" className="secondary-button" onClick={() => { setConfigTarget(null); setEditorOpen(false); setMessage(""); }}>← 返回对象列表</button>
          <div className="config-page-heading">
            <span>{selectedPolicy?.policyNo} / {scopeLabels[configTarget.scope]}</span>
            <div className="section-title">{configTarget.target.name}</div>
            <small>{configTarget.target.code}{configTarget.target.parentLabel ? ` ｜ 上级：${configTarget.target.parentLabel}` : ""}</small>
          </div>
          <button type="button" onClick={startCreate} disabled={busy}>新增参数</button>
        </section>

        {editorOpen ? (
          <section className="panel config-editor-panel">
            <div className="panel-title-row">
              <div className="section-title">{editor.id ? "编辑参数" : "新增参数"}</div>
              <button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>取消</button>
            </div>
            <div className="config-editor-grid">
              <label className="config-parameter-name-field"><span>参数名称</span><CustomDropdown value={editor.definitionCode} options={definitionOptions} onChange={(value) => {
                const definition = definitions.find((item) => item.parameterCode === value);
                setEditor((current) => ({ ...current, definitionCode: value, parameterValue: definition?.valueType === "boolean" ? "true" : "" }));
              }} /></label>
              <div className="config-definition-meta">
                <span>值类型<strong>{selectedDefinition ? valueTypeLabel(selectedDefinition.valueType) : "-"}</strong></span>
                <span>默认单位<strong>{selectedDefinition?.unit ?? "无"}</strong></span>
              </div>
              <label>
                <span>参数值</span>
                {selectedDefinition?.valueType === "boolean"
                  ? <CustomDropdown value={editor.parameterValue as "true" | "false"} options={[{ value: "true", label: "是" }, { value: "false", label: "否" }]} onChange={(value) => setEditor((current) => ({ ...current, parameterValue: value }))} />
                  : <input value={editor.parameterValue} onChange={(event) => setEditor((current) => ({ ...current, parameterValue: event.target.value }))} placeholder="请输入参数值" />}
              </label>
              <label className="config-enabled-field"><span>状态</span><button type="button" className={`config-toggle ${editor.enabled ? "active" : ""}`} aria-pressed={editor.enabled} onClick={() => setEditor((current) => ({ ...current, enabled: !current.enabled }))}><i />{editor.enabled ? "启用" : "停用"}</button></label>
              <label className="config-description-field"><span>参数说明</span><input value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} placeholder="说明该参数的计算口径和适用范围" /></label>
            </div>
            <div className="config-editor-actions"><button type="button" onClick={() => void saveParameter()} disabled={busy}>{busy ? "保存中..." : "保存参数"}</button></div>
          </section>
        ) : null}

        <section className="panel config-table-panel">
          <div className="panel-title-row"><div className="section-title">理算参数</div><span className="muted">{visibleParameters.length} 项</span></div>
          {message ? <div className="config-message" aria-live="polite">{message}</div> : null}
          <div className="table-wrapper config-table-wrapper">
            <table>
              <thead><tr><th>参数名称</th><th>类型</th><th>参数值</th><th>状态</th><th>更新时间</th><th className="actions-col">操作</th></tr></thead>
              <tbody>
                {visibleParameters.length ? visibleParameters.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.parameterName}</strong>{item.description ? <small className="table-description">{item.description}</small> : null}</td>
                    <td>{valueTypeLabel(item.valueType)}</td>
                    <td>{item.valueType === "boolean" ? item.parameterValue === "true" ? "是" : "否" : item.parameterValue}{item.unit ? ` ${item.unit}` : ""}</td>
                    <td><span className={`status-badge ${item.enabled ? "enabled" : "disabled"}`}>{item.enabled ? "启用" : "停用"}</span></td>
                    <td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className="actions-cell">
                      {pendingDeleteId === item.id ? (
                        <span className="inline-confirm"><span>确认删除？</span><button type="button" className="danger-link" onClick={() => void removeParameter(item.id)} disabled={busy}>确认</button><button type="button" className="action-link" onClick={() => setPendingDeleteId(null)}>取消</button></span>
                      ) : <><button type="button" className="action-link" onClick={() => startEdit(item)}>编辑</button><button type="button" className="danger-link" onClick={() => setPendingDeleteId(item.id)}>删除</button></>}
                    </td>
                  </tr>
                )) : <tr><td colSpan={6} className="config-empty-cell">当前对象尚未配置理算参数。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="calculation-config-page">
      <section className="panel config-policy-search">
        <div>
          <div className="section-title">保单理算配置</div>
          <p className="config-intro">先查询并确认保单，再从保单层级结构中选择需要配置的对象。</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); searchPolicies(); }}>
          <label>
            <span>保单</span>
            <input value={policyKeyword} onChange={(event) => setPolicyKeyword(event.target.value.toUpperCase())} placeholder="请输入完整保单号，例如 GI2026000001" />
          </label>
          <button type="submit">查询</button>
          <button type="button" className="secondary-button" onClick={() => { setPolicyKeyword(""); setSelectedPolicyId(null); setSearched(false); setMessage(""); }}>重置</button>
        </form>
      </section>

      {message ? <div className="config-message standalone" aria-live="polite">{message}</div> : null}

      {searched && selectedPolicy ? (
        <>
          <section className="panel config-policy-basic">
                <div className="section-title">保单基本信息</div>
                <div className="config-basic-grid">
                  <div><span>保单号</span><strong>{selectedPolicy.policyNo}</strong></div>
                  <div><span>保单名称</span><strong>{selectedPolicy.policyName ?? "-"}</strong></div>
                  <div><span>投保单位</span><strong>{selectedPolicy.applicantName}</strong></div>
                  <div><span>保单状态</span><strong>{formatPolicyStatus(selectedPolicy.policyStatus)}</strong></div>
                  <div><span>生效日期</span><strong>{selectedPolicy.effectiveDate}</strong></div>
                  <div><span>终止日期</span><strong>{selectedPolicy.expiryDate}</strong></div>
                  <div><span>总保费</span><strong>{selectedPolicy.totalPremium?.toLocaleString("zh-CN") ?? "-"} {selectedPolicy.currency}</strong></div>
                  <div><span>被保人数</span><strong>{selectedPolicy.insuredCount ?? "-"}</strong></div>
                </div>
          </section>

          <section className="panel config-hierarchy-panel">
                <div className="panel-title-row"><div className="section-title">理算配置对象</div><span className="muted">{hierarchyRows.length} 个对象</span></div>
                <div className="table-wrapper config-hierarchy-table">
                  <table>
                    <thead><tr><th>层级</th><th>对象编码</th><th>对象名称</th><th>上级对象</th><th>已配置参数</th><th className="actions-col">操作</th></tr></thead>
                    <tbody>{hierarchyRows.map((row) => {
                      const parameterCount = items.filter((item) => item.scope === row.scope && item.targetId === row.target.id).length;
                      return (
                        <tr key={`${row.scope}-${row.target.id}`}>
                          <td><span className={`config-level-badge ${row.scope}`}>{scopeLabels[row.scope]}</span></td>
                          <td><code style={{ marginLeft: `${row.level * 12}px` }}>{row.target.code}</code></td>
                          <td><span className="config-tree-name" style={{ paddingLeft: `${row.level * 18}px` }}>{row.level > 0 ? "↳ " : ""}{row.target.name}</span></td>
                          <td>{row.parentName ?? "-"}</td>
                          <td>{parameterCount} 项</td>
                          <td className="actions-cell"><button type="button" className="action-link" onClick={() => openConfiguration(row)}>配置</button></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
