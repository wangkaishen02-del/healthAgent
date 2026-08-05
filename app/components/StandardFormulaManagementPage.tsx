"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import { apiFetch } from "../../src/api/client";
import type { CalculationVariableCategory, CalculationVariableView, FormulaStep, StandardFormulaView } from "../../src/calculation/automation-types";
import { placeFormulaStep } from "../../src/calculation/formula-step-order";
import { buildStandardFormulaConfigurationVariables } from "../../src/calculation/standard-formula-variables";
import type { CalculationParameterDefinition } from "../../src/underwriting/types";
import {
  CustomDropdown,
  emptyFormulaStep,
  formulaExpressionElements,
  variableCategoryLabels,
} from "./CalculationConfigSupport";

type EditorMode = "create" | "view" | "edit";
type FormulaDraft = {
  id?: number;
  formulaCode?: string;
  formulaName: string;
  matchExpression: string;
  tags: string[];
  steps: FormulaStep[];
  referenceCount: number;
  sourcePolicyId?: string;
};

const emptyDraft = (): FormulaDraft => ({
  formulaName: "",
  matchExpression: "",
  tags: [],
  steps: [],
  referenceCount: 0,
});

function standardFormulaVariableOptionLabel(variable: CalculationVariableView) {
  return variable.formulaName ?? variable.variableName;
}

const StandardFormulaManagementPage = forwardRef<RegisteredPageController>(function StandardFormulaManagementPage(_, assistantRef) {
  const [items, setItems] = useState<StandardFormulaView[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [draft, setDraft] = useState<FormulaDraft>(emptyDraft);
  const [tagInput, setTagInput] = useState("");
  const [automationVariables, setAutomationVariables] = useState<CalculationVariableView[]>([]);
  const [parameterDefinitions, setParameterDefinitions] = useState<CalculationParameterDefinition[]>([]);
  const [defaultPolicyId, setDefaultPolicyId] = useState("");
  const [variablePolicyId, setVariablePolicyId] = useState("");
  const [stepEditor, setStepEditor] = useState<FormulaStep>(() => emptyFormulaStep(0));
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [activeFormulaEditor, setActiveFormulaEditor] = useState<"match" | "step">("step");
  const [manualFormulaElement, setManualFormulaElement] = useState("");
  const [fixedParameterSelection, setFixedParameterSelection] = useState<{ variableName: string; options: string[] } | null>(null);
  const [fixedParameterOperator, setFixedParameterOperator] = useState<"" | "=" | "≠">("");
  const [fixedParameterValue, setFixedParameterValue] = useState("");

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

  async function loadVariableLibrary(policyId: string) {
    if (!policyId || policyId === variablePolicyId) return;
    const response = await apiFetch(`/api/automatic-calculation?policyId=${encodeURIComponent(policyId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { variables?: CalculationVariableView[] };
    setAutomationVariables(result.variables ?? []);
    setVariablePolicyId(policyId);
  }

  useEffect(() => {
    void load();
    void (async () => {
      const response = await apiFetch("/api/calculation-parameters", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as { policies?: Array<{ id: string; policyStatus?: string }>; definitions?: CalculationParameterDefinition[] };
      const policyId = result.policies?.find((item) => item.policyStatus === "enabled")?.id ?? result.policies?.[0]?.id ?? "";
      setParameterDefinitions(result.definitions ?? []);
      setDefaultPolicyId(policyId);
      if (policyId) await loadVariableLibrary(policyId);
    })();
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => [item.formulaCode, item.formulaName, ...(item.tags ?? [])].some((value) => value.toLowerCase().includes(normalized)));
  }, [items, keyword]);

  const formulaLibraryVariables = [...new Map(
    [
      ...automationVariables.filter((variable) => variable.category !== "benefit"),
      ...buildStandardFormulaConfigurationVariables(parameterDefinitions, variablePolicyId || defaultPolicyId),
    ]
      .filter((variable) => variable.valueType !== "date")
      .map((variable) => [`${variable.category}:${variable.formulaName ?? variable.variableName}`, variable]),
  ).values()];
  const knownFormulaElementNames = [
    ...formulaLibraryVariables.map((variable) => variable.formulaName ?? variable.variableName),
    ...draft.steps.map((step) => step.name),
  ];

  function resetStepEditor(stepCount: number) {
    setStepEditor(emptyFormulaStep(stepCount));
    setEditingStepIndex(null);
    setActiveFormulaEditor("step");
    setFixedParameterSelection(null);
  }

  function openItem(item: StandardFormulaView, nextMode: "view" | "edit") {
    const steps = (item.steps ?? []).map((step) => ({ ...step, ledgerTarget: step.ledgerTarget ? { ...step.ledgerTarget } : undefined }));
    setDraft({
      id: item.id,
      formulaCode: item.formulaCode,
      formulaName: item.formulaName,
      matchExpression: item.matchExpression,
      tags: [...(item.tags ?? [])],
      steps,
      referenceCount: item.referenceCount ?? 0,
      sourcePolicyId: item.sourcePolicyId,
    });
    resetStepEditor(steps.length);
    setMode(nextMode);
    setTagInput("");
    setMessage("");
    void loadVariableLibrary(item.sourcePolicyId ?? defaultPolicyId);
  }

  function startCreate() {
    setDraft(emptyDraft());
    resetStepEditor(0);
    setMode("create");
    setTagInput("");
    setMessage("");
    void loadVariableLibrary(defaultPolicyId);
  }

  function addTag() {
    const tag = tagInput.trim().slice(0, 30);
    if (!tag || draft.tags.includes(tag)) return;
    setDraft((current) => ({ ...current, tags: [...current.tags, tag].slice(0, 20) }));
    setTagInput("");
  }

  function appendFormulaToken(token: string | string[]) {
    const tokens = Array.isArray(token) ? token : formulaExpressionElements(token, knownFormulaElementNames);
    if (activeFormulaEditor === "match") {
      setDraft((current) => ({ ...current, matchExpression: [...formulaExpressionElements(current.matchExpression, knownFormulaElementNames), ...tokens].join(" ") }));
    } else {
      setStepEditor((current) => ({ ...current, expression: [...formulaExpressionElements(current.expression, knownFormulaElementNames), ...tokens].join(" ") }));
    }
  }

  function selectFormulaVariable(variable: CalculationVariableView) {
    const options = variable.options ?? (variable.valueType === "boolean" ? ["是", "否"] : undefined);
    if (!options) {
      appendFormulaToken(variable.formulaName ?? variable.variableName);
      return;
    }
    setFixedParameterSelection({ variableName: variable.formulaName ?? variable.variableName, options });
    setFixedParameterOperator("");
    setFixedParameterValue("");
  }

  function confirmFixedParameterSelection() {
    if (!fixedParameterSelection || !fixedParameterOperator || !fixedParameterValue) return;
    const escapedValue = fixedParameterValue.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
    appendFormulaToken([fixedParameterSelection.variableName, fixedParameterOperator, `"${escapedValue}"`]);
    setFixedParameterSelection(null);
    setFixedParameterOperator("");
    setFixedParameterValue("");
  }

  function appendNumericConstant() {
    const value = manualFormulaElement.trim();
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
      setMessage("常数参数只能输入数字。");
      return;
    }
    appendFormulaToken(value);
    setManualFormulaElement("");
    setMessage("");
  }

  function removeFormulaElement(target: "match" | "step", index: number) {
    const expression = target === "match" ? draft.matchExpression : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    elements.splice(index, 1);
    if (target === "match") setDraft((current) => ({ ...current, matchExpression: elements.join(" ") }));
    else setStepEditor((current) => ({ ...current, expression: elements.join(" ") }));
  }

  function renderFormulaExpressionEditor(target: "match" | "step", expression: string) {
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    return (
      <div className="formula-expression-editor-stack">
        <div className={`formula-expression-elements editable ${activeFormulaEditor === target ? "active-editor" : ""}`} onClick={() => setActiveFormulaEditor(target)}>
          {!elements.length ? <small className="formula-expression-empty">点击此处后，从上方选择参数和公式元素</small> : null}
          {elements.map((element, index) => <i key={`${target}-${index}-${element}`} title="双击删除" onDoubleClick={() => removeFormulaElement(target, index)}>{element}</i>)}
        </div>
        <small className="standard-formula-expression-tip">双击表达式中的元素可删除</small>
      </div>
    );
  }

  function editMatchStep() {
    setActiveFormulaEditor("match");
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(draft.steps.length));
    setMessage("");
  }

  function editFormulaStep(index: number) {
    const step = draft.steps[index];
    setEditingStepIndex(index);
    setStepEditor({ ...step, ledgerTarget: step.ledgerTarget ? { ...step.ledgerTarget } : undefined });
    setActiveFormulaEditor("step");
    setMessage("");
  }

  function cancelFormulaStepEditing() {
    resetStepEditor(draft.steps.length);
    setMessage("");
  }

  function saveCurrentEditor() {
    if (activeFormulaEditor === "match") {
      if (!draft.matchExpression.trim()) {
        setMessage("请配置第一步自动匹配条件。");
        return;
      }
      resetStepEditor(draft.steps.length);
      setMessage("第一步已更新，保存整套标准公式后生效。");
      return;
    }
    if (!stepEditor.name.trim() || !stepEditor.expression.trim()) {
      setMessage("请填写当前步骤名称和公式表达式。");
      return;
    }
    if (draft.steps.some((step, index) => index !== editingStepIndex && step.name.trim() === stepEditor.name.trim())) {
      setMessage("步骤名称不能重复。");
      return;
    }
    const nextStep = { ...stepEditor, id: stepEditor.id || crypto.randomUUID(), name: stepEditor.name.trim(), expression: stepEditor.expression.trim() };
    const nextSteps = placeFormulaStep(draft.steps, nextStep, editingStepIndex);
    const normalizedSteps = nextSteps.some((step) => step.result)
      ? nextSteps
      : nextSteps.map((step, index) => ({ ...step, result: index === nextSteps.length - 1 }));
    setDraft((current) => ({ ...current, steps: normalizedSteps }));
    resetStepEditor(normalizedSteps.length);
    setMessage("公式步骤已更新，保存整套标准公式后生效。");
  }

  function moveFormulaStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setDraft((current) => ({ ...current, steps }));
    resetStepEditor(steps.length);
  }

  function selectFormulaResult(index: number) {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => ({ ...step, result: stepIndex === index })) }));
  }

  function deleteFormulaStep(index: number) {
    if (draft.steps.length <= 1) return;
    const steps = draft.steps.filter((_, stepIndex) => stepIndex !== index);
    const normalized = steps.some((step) => step.result) ? steps : steps.map((step, stepIndex) => ({ ...step, result: stepIndex === steps.length - 1 }));
    setDraft((current) => ({ ...current, steps: normalized }));
    resetStepEditor(normalized.length);
  }

  async function save() {
    if (activeFormulaEditor === "step" && (stepEditor.name.trim() || stepEditor.expression.trim())) {
      setMessage("当前步骤尚未加入步骤列表，请先点击步骤编辑区的“保存”。");
      return;
    }
    if (!draft.formulaName.trim() || !draft.matchExpression.trim() || !draft.steps.length || draft.steps.some((step) => !step.name.trim() || !step.expression.trim())) {
      setMessage("请完整填写公式名称、自动匹配条件以及至少一个公式步骤。");
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
    setDraft({ ...draft, ...result, tags: [...(result.tags ?? [])], steps: result.steps.map((step) => ({ ...step })) });
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
        {message && !mode ? <div className={`config-message ${message.includes("已") ? "success" : ""}`}>{message}</div> : null}
        <div className="table-wrapper standard-formula-table"><table><thead><tr><th>公式编号</th><th>公式名称</th><th>标签</th><th>步骤</th><th>引用责任</th><th>更新时间</th><th className="actions-col">操作</th></tr></thead><tbody>
          {filteredItems.map((item) => <tr key={item.id}><td><code>{item.formulaCode}</code></td><td><strong>{item.formulaName}</strong></td><td><div className="standard-formula-tags">{item.tags?.length ? item.tags.map((tag) => <span key={tag}>{tag}</span>) : <span className="muted">未设置</span>}</div></td><td>{(item.steps?.length ?? 0) + 1} 步</td><td>{item.referenceCount ?? 0}</td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</td><td className="actions-cell"><button type="button" className="action-link" onClick={() => openItem(item, "view")}>查看</button><button type="button" className="action-link" onClick={() => openItem(item, "edit")}>编辑</button><button type="button" className="danger-link" onClick={() => void remove(item)}>删除</button></td></tr>)}
          {!loading && !filteredItems.length ? <tr><td colSpan={7} className="config-empty-cell">暂无标准公式，可点击“新增标准公式”创建。</td></tr> : null}
        </tbody></table></div>
      </section>

      {mode ? <div className="standard-formula-workspace">
        <section className="panel standard-formula-editor-heading">
          <div><div className="section-title">{mode === "create" ? "新增标准公式" : mode === "edit" ? "编辑标准公式" : "查看标准公式"}</div>{draft.formulaCode ? <small className="muted">公式编号：{draft.formulaCode} · 当前引用 {draft.referenceCount} 个责任</small> : <small className="muted">编辑方式与责任公式配置一致，先组合表达式，再加入步骤列表。</small>}</div>
          <div className="page-header-actions">{readOnly ? <button type="button" onClick={() => setMode("edit")}>编辑</button> : <button type="button" onClick={() => void save()} disabled={loading}>{loading ? "保存中..." : "保存标准公式"}</button>}<button type="button" className="secondary-button" onClick={() => setMode(null)}>关闭</button></div>
        </section>

        {message ? <div className={`config-message standard-formula-editor-message ${message.includes("已") ? "success" : ""}`}>{message}</div> : null}
        <fieldset disabled={readOnly || loading} className="standard-formula-fieldset">
          <section className="panel standard-formula-meta-panel">
            <div className="standard-formula-basic-fields"><label><span>公式名称</span><input value={draft.formulaName} onChange={(event) => setDraft((current) => ({ ...current, formulaName: event.target.value }))} placeholder="例如 标准住院医疗给付公式" /></label></div>
            <div className="standard-formula-tag-editor"><strong>自定义标签</strong><div className="standard-formula-tags">{draft.tags.map((tag) => <span key={tag}>{tag}<button type="button" aria-label={`删除标签${tag}`} onClick={() => setDraft((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}>×</button></span>)}</div><div><input value={tagInput} maxLength={30} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="例如 住院、医疗险、年度限额" /><button type="button" onClick={addTag}>增加标签</button></div></div>
          </section>

          <section className="panel formula-parameter-library">
            <div className="panel-title-row"><div><div className="section-title">公式参数库</div><small className="muted">按分类选择参数，选中后自动追加到正在操作的公式步骤</small></div></div>
            <div className="formula-variable-groups">
              {(Object.keys(variableCategoryLabels) as CalculationVariableCategory[]).map((category) => {
                const variables = formulaLibraryVariables.filter((item) => item.category === category);
                if (!variables.length) return null;
                return <div key={category}><strong>{variableCategoryLabels[category]}</strong><CustomDropdown value="" options={variables.map((variable) => ({ value: variable.formulaName ?? variable.variableName, label: standardFormulaVariableOptionLabel(variable) }))} onChange={(value) => { const variable = variables.find((item) => (item.formulaName ?? item.variableName) === value); if (variable) selectFormulaVariable(variable); }} /></div>;
              })}
              {activeFormulaEditor === "step" && draft.steps.length ? <div><strong>已添加步骤</strong><CustomDropdown value="" options={draft.steps.slice(0, editingStepIndex ?? draft.steps.length).map((step) => ({ value: step.name, label: step.name }))} onChange={(value) => { if (value) appendFormulaToken(value); }} /></div> : null}
            </div>
            <div className="formula-library-tools">
              <div className="formula-library-tools-heading"><div><strong>符号、逻辑与常数</strong><small>当前加入到：<b>{activeFormulaEditor === "match" ? "第一步 · 自动匹配条件" : editingStepIndex === null ? "新增公式步骤" : `第 ${editingStepIndex + 2} 步`}</b></small></div></div>
              <div className="formula-library-tools-content">
                <div className="formula-tool-group"><strong>符号与逻辑</strong><div>{["+", "-", "*", "/", "(", ")", "并且", "或者", "=", "≠", ">", "<", "≥", "≤"].map((operator) => <button type="button" key={operator} onClick={() => appendFormulaToken(operator)}>{operator}</button>)}<button type="button" onClick={() => appendFormulaToken(["取大", "(", ",", ")"])}>取大（，）</button><button type="button" onClick={() => appendFormulaToken(["取小", "(", ",", ")"])}>取小（，）</button><button type="button" onClick={() => appendFormulaToken(["如果", "(", ")", "则", "(", ")", "否则", "(", ")"])}>如果（ ）则（ ）否则（ ）</button></div></div>
                <div className="formula-tool-group formula-constant-group"><strong>常数参数</strong><div><input type="number" step="any" value={manualFormulaElement} onChange={(event) => setManualFormulaElement(event.target.value)} placeholder="例如 100、0.8" /><button type="button" onClick={appendNumericConstant}>加入常数</button></div></div>
              </div>
            </div>
            {fixedParameterSelection ? <div className="formula-fixed-parameter-editor"><strong>{fixedParameterSelection.variableName}</strong><select value={fixedParameterOperator} onChange={(event) => setFixedParameterOperator(event.target.value as "" | "=" | "≠")}><option value="">选择判断符</option><option value="=">等于</option><option value="≠">不等于</option></select><select value={fixedParameterValue} onChange={(event) => setFixedParameterValue(event.target.value)}><option value="">选择配置值</option>{fixedParameterSelection.options.map((option) => <option key={option}>{option}</option>)}</select><button type="button" onClick={confirmFixedParameterSelection} disabled={!fixedParameterOperator || !fixedParameterValue}>加入公式</button><button type="button" className="secondary-button" onClick={() => setFixedParameterSelection(null)}>取消</button></div> : null}
          </section>

          <section className="panel formula-editor-panel">
            <div className="formula-step-operation">
              <div className="formula-step-control-row">
                <label><span>步骤名称</span><input value={activeFormulaEditor === "match" ? "自动匹配条件" : stepEditor.name} disabled={activeFormulaEditor === "match"} onChange={(event) => setStepEditor((current) => ({ ...current, name: event.target.value }))} placeholder="请输入中文步骤名称" /></label>
                <label><span>累计台账</span><select value={activeFormulaEditor === "match" ? "" : stepEditor.ledgerTarget?.code ?? ""} disabled={activeFormulaEditor === "match"} onChange={(event) => { const code = event.target.value; const names: Record<string, string> = { annual_deductible: "累计免赔额", annual_payment: "累计给付金额" }; setStepEditor((current) => ({ ...current, ledgerTarget: code ? { code, name: names[code] } : undefined })); }}><option value="">不累计</option><option value="annual_deductible">累计免赔额</option><option value="annual_payment">累计给付金额</option></select></label>
                <div className="formula-step-inline-actions"><button type="button" className="secondary-button" onClick={cancelFormulaStepEditing}>取消</button><button type="button" onClick={saveCurrentEditor}>保存</button></div>
              </div>
              <div className="formula-step-expression"><span>公式表达式</span>{renderFormulaExpressionEditor(activeFormulaEditor, activeFormulaEditor === "match" ? draft.matchExpression : stepEditor.expression)}</div>
            </div>
            <div className="table-wrapper formula-step-table"><table><thead><tr><th>顺序</th><th>步骤名称</th><th>公式表达式</th><th>公式结果</th><th>累计台账</th><th>操作</th></tr></thead><tbody>
              <tr className="formula-match-fixed-row" onDoubleClick={editMatchStep}><td><strong>1</strong></td><td><strong>自动匹配条件</strong><small className="table-description">必录 · 固定第一步</small></td><td><div className="formula-expression-elements formula-expression-view">{formulaExpressionElements(draft.matchExpression, knownFormulaElementNames).map((element, index) => <i key={`${element}-${index}`}>{element}</i>)}</div></td><td>-</td><td>-</td><td className="formula-step-actions"><button type="button" className="action-link" onClick={editMatchStep}>修改</button></td></tr>
              {draft.steps.map((step, index) => <tr key={`${step.id}-${index}`} className={step.result ? "formula-result-row" : ""} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button, label, input, select")) editFormulaStep(index); }}><td><strong>{index + 2}</strong></td><td><strong>{step.name}</strong></td><td><div className="formula-expression-elements formula-expression-view">{formulaExpressionElements(step.expression, knownFormulaElementNames).map((element, elementIndex) => <i key={`${element}-${elementIndex}`}>{element}</i>)}</div></td><td><label className="formula-result-radio"><input type="checkbox" checked={step.result} onChange={() => selectFormulaResult(index)} /><i className="formula-result-checkbox" aria-hidden="true" /><span>公式结果</span></label></td><td>{step.ledgerTarget?.name ?? "不累计"}</td><td className="formula-step-actions"><button type="button" className="action-link" onClick={() => editFormulaStep(index)}>修改</button><button type="button" className="action-link" disabled={index === 0} onClick={() => moveFormulaStep(index, -1)}>上移</button><button type="button" className="action-link" disabled={index === draft.steps.length - 1} onClick={() => moveFormulaStep(index, 1)}>下移</button><button type="button" className="danger-link" disabled={draft.steps.length <= 1} onClick={() => deleteFormulaStep(index)}>删除</button></td></tr>)}
            </tbody></table></div>
          </section>
        </fieldset>
      </div> : null}
    </div>
  );
});

export default StandardFormulaManagementPage;
