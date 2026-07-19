"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
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
type HierarchyRow = ConfigTarget & {
  key: string;
  level: number;
  parentName?: string;
  ancestorKeys: string[];
  hasChildren: boolean;
};
type HierarchyPathNode = ConfigTarget;

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

const AGENT_LIST_CONTEXT_LIMIT = 50;

function buildHierarchyRows(catalog: CalculationConfigCatalog, policyId: string | null): HierarchyRow[] {
  if (!policyId) return [];
  const rows: HierarchyRow[] = [];
  const policyTarget = catalog.policy.find((target) => target.id === policyId);
  const policyKey = `policy-${policyId}`;
  const policyPlans = catalog.plan.filter((plan) => plan.policyId === policyId);
  if (policyTarget) rows.push({
    key: policyKey,
    scope: "policy",
    target: policyTarget,
    level: 0,
    ancestorKeys: [],
    hasChildren: policyPlans.length > 0,
  });

  policyPlans.forEach((plan) => {
    const planKey = `plan-${plan.id}`;
    const planProducts = catalog.product.filter((product) => product.planId === plan.id);
    rows.push({
      key: planKey,
      scope: "plan",
      target: plan,
      level: 1,
      parentName: policyTarget?.name,
      ancestorKeys: [policyKey],
      hasChildren: planProducts.length > 0,
    });
    planProducts.forEach((product) => {
      const productKey = `product-${product.id}`;
      const productBenefits = catalog.benefit.filter((benefit) => benefit.productId === product.id);
      rows.push({
        key: productKey,
        scope: "product",
        target: product,
        level: 2,
        parentName: plan.name,
        ancestorKeys: [policyKey, planKey],
        hasChildren: productBenefits.length > 0,
      });
      productBenefits.forEach((benefit) => {
        rows.push({
          key: `benefit-${benefit.id}`,
          scope: "benefit",
          target: benefit,
          level: 3,
          parentName: product.name,
          ancestorKeys: [policyKey, planKey, productKey],
          hasChildren: false,
        });
      });
    });
  });
  return rows;
}

function buildTargetPath(catalog: CalculationConfigCatalog, selected: ConfigTarget): HierarchyPathNode[] {
  const path: HierarchyPathNode[] = [];
  const policy = catalog.policy.find((target) => target.id === selected.target.policyId);
  if (policy) path.push({ scope: "policy", target: policy });

  if (selected.scope === "policy") return path;
  const plan = selected.scope === "plan"
    ? selected.target
    : catalog.plan.find((target) => target.id === selected.target.planId);
  if (plan) path.push({ scope: "plan", target: plan });

  if (selected.scope === "plan") return path;
  const product = selected.scope === "product"
    ? selected.target
    : catalog.product.find((target) => target.id === selected.target.productId);
  if (product) path.push({ scope: "product", target: product });

  if (selected.scope === "benefit") path.push(selected);
  return path;
}

function buildHierarchyContext(rows: HierarchyRow[], items: CalculationParameter[]) {
  const contextRows = rows.slice(0, AGENT_LIST_CONTEXT_LIMIT);
  return {
    type: "list_result",
    pageId: "calculation_config",
    regionId: "calculation_policy_hierarchy",
    total: rows.length,
    returnedItemCount: contextRows.length,
    contextLimit: AGENT_LIST_CONTEXT_LIMIT,
    truncated: rows.length > contextRows.length,
    items: contextRows.map((row, index) => ({
      row: index + 1,
      scope: row.scope,
      scopeLabel: scopeLabels[row.scope],
      targetId: row.target.id,
      code: row.target.code,
      name: row.target.name,
      parentName: row.parentName,
      parameterCount: items.filter((item) => item.scope === row.scope && item.targetId === row.target.id).length,
    })),
  };
}

function buildParameterContext(target: ConfigTarget, items: CalculationParameter[]) {
  const parameters = items.filter((item) => item.scope === target.scope && item.targetId === target.target.id);
  const contextRows = parameters.slice(0, AGENT_LIST_CONTEXT_LIMIT);
  return {
    type: "list_result",
    pageId: "calculation_config",
    regionId: "calculation_parameter_list",
    target: { scope: target.scope, id: target.target.id, code: target.target.code, name: target.target.name },
    total: parameters.length,
    returnedItemCount: contextRows.length,
    contextLimit: AGENT_LIST_CONTEXT_LIMIT,
    truncated: parameters.length > contextRows.length,
    items: contextRows.map((item, index) => ({
      row: index + 1,
      id: item.id,
      parameterCode: item.parameterCode,
      parameterName: item.parameterName,
      valueType: item.valueType,
      parameterValue: item.parameterValue,
      unit: item.unit,
      enabled: item.enabled,
      description: item.description,
    })),
  };
}

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

const CalculationConfigPage = forwardRef<RegisteredPageController>(function CalculationConfigPage(_, assistantRef) {
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
  const [collapsedHierarchyKeys, setCollapsedHierarchyKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const catalogRef = useRef<CalculationConfigCatalog>(emptyCatalog);
  const policiesRef = useRef<Policy[]>([]);
  const itemsRef = useRef<CalculationParameter[]>([]);
  const definitionsRef = useRef<CalculationParameterDefinition[]>([]);
  const policyKeywordRef = useRef("");
  const selectedPolicyIdRef = useRef<string | null>(null);
  const configTargetRef = useRef<ConfigTarget | null>(null);
  const editorRef = useRef<EditorState>(emptyEditor);
  const editorOpenRef = useRef(false);
  const pendingDeleteIdRef = useRef<string | null>(null);
  const dataReadyRef = useRef<Promise<void>>(Promise.resolve());

  function updatePolicyKeyword(value: string) {
    policyKeywordRef.current = value;
    setPolicyKeyword(value);
  }

  function updateSelectedPolicyId(value: string | null) {
    selectedPolicyIdRef.current = value;
    setSelectedPolicyId(value);
  }

  function updateConfigTarget(value: ConfigTarget | null) {
    configTargetRef.current = value;
    setConfigTarget(value);
  }

  function updateEditor(value: EditorState | ((current: EditorState) => EditorState)) {
    const next = typeof value === "function" ? value(editorRef.current) : value;
    editorRef.current = next;
    setEditor(next);
  }

  function updateEditorOpen(value: boolean) {
    editorOpenRef.current = value;
    setEditorOpen(value);
  }

  function updatePendingDeleteId(value: string | null) {
    pendingDeleteIdRef.current = value;
    setPendingDeleteId(value);
  }

  useEffect(() => {
    dataReadyRef.current = (async () => {
      const response = await fetch("/api/calculation-parameters", { cache: "no-store" });
      const data = await response.json() as {
        catalog: CalculationConfigCatalog;
        policies: Policy[];
        items: CalculationParameter[];
        definitions: CalculationParameterDefinition[];
      };
      catalogRef.current = data.catalog;
      policiesRef.current = data.policies;
      itemsRef.current = data.items;
      definitionsRef.current = data.definitions;
      setCatalog(data.catalog);
      setPolicies(data.policies);
      setItems(data.items);
      setDefinitions(data.definitions);
    })();
  }, []);

  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? null;

  const hierarchyRows = useMemo(
    () => buildHierarchyRows(catalog, selectedPolicyId),
    [catalog, selectedPolicyId],
  );
  const visibleHierarchyRows = hierarchyRows.filter((row) =>
    row.ancestorKeys.every((key) => !collapsedHierarchyKeys.has(key)),
  );

  useEffect(() => {
    setCollapsedHierarchyKeys(new Set());
  }, [selectedPolicyId]);

  function toggleHierarchyRow(key: string) {
    setCollapsedHierarchyKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const visibleParameters = configTarget
    ? items.filter((item) => item.scope === configTarget.scope && item.targetId === configTarget.target.id)
    : [];
  const configTargetPath = configTarget ? buildTargetPath(catalog, configTarget) : [];
  const selectedDefinition = definitions.find((definition) => definition.parameterCode === editor.definitionCode);
  const definitionOptions: Option<string>[] = configTarget
    ? definitions
      .filter((definition) => definition.applicableScopes.includes(configTarget.scope))
      .filter((definition) => definition.parameterCode === editor.definitionCode || !visibleParameters.some((item) => item.parameterCode === definition.parameterCode))
      .map((definition) => ({ value: definition.parameterCode, label: definition.parameterName }))
    : [];

  function searchPolicies() {
    const keyword = policyKeywordRef.current.trim().toLowerCase();
    if (!keyword) {
      setMessage("请输入完整保单号。");
      return { type: "operation_error", reason: "field_required", fieldId: "policyNo" };
    }
    const matchedPolicy = policiesRef.current.find((policy) => policy.policyNo.toLowerCase() === keyword);
    updateSelectedPolicyId(matchedPolicy?.id ?? null);
    setSearched(true);
    updateConfigTarget(null);
    setMessage(matchedPolicy ? "" : "未查询到该保单。");
    if (!matchedPolicy) return { type: "operation_error", reason: "policy_not_found", policyNo: policyKeywordRef.current };
    return {
      type: "policy_context",
      policy: {
        id: matchedPolicy.id,
        policyNo: matchedPolicy.policyNo,
        policyName: matchedPolicy.policyName,
        applicantName: matchedPolicy.applicantName,
      },
      hierarchy: buildHierarchyContext(
        buildHierarchyRows(catalogRef.current, matchedPolicy.id),
        itemsRef.current,
      ),
    };
  }

  function openConfiguration(row: ConfigTarget) {
    updateConfigTarget(row);
    updateEditorOpen(false);
    updatePendingDeleteId(null);
    setMessage("");
    return buildParameterContext(row, itemsRef.current);
  }

  function startCreate() {
    const target = configTargetRef.current;
    if (!target) return { type: "operation_error", reason: "configuration_target_required" };
    const targetParameters = itemsRef.current.filter((item) => item.scope === target.scope && item.targetId === target.target.id);
    const firstDefinition = definitionsRef.current.find((definition) =>
      definition.applicableScopes.includes(target.scope)
      && !targetParameters.some((item) => item.parameterCode === definition.parameterCode),
    );
    if (!firstDefinition) {
      setMessage("当前对象的可选参数均已配置。");
      return { type: "operation_error", reason: "no_available_definition" };
    }
    updateEditor({
      ...emptyEditor,
      definitionCode: firstDefinition.parameterCode,
      parameterValue: firstDefinition.valueType === "boolean" ? "true" : "",
    });
    updateEditorOpen(true);
    updatePendingDeleteId(null);
    setMessage("");
    return {
      type: "editor_opened",
      mode: "create",
      target: { scope: target.scope, id: target.target.id, code: target.target.code, name: target.target.name },
      defaultDefinitionCode: firstDefinition.parameterCode,
    };
  }

  function startEdit(item: CalculationParameter) {
    updateEditor({
      id: item.id,
      definitionCode: item.parameterCode,
      parameterValue: item.parameterValue,
      description: item.description ?? "",
      enabled: item.enabled,
    });
    updateEditorOpen(true);
    updatePendingDeleteId(null);
    setMessage("");
    return { type: "editor_opened", mode: "edit", parameterId: item.id, parameterCode: item.parameterCode };
  }

  async function saveParameter() {
    const target = configTargetRef.current;
    const currentEditor = editorRef.current;
    if (!target || !currentEditor.definitionCode || !currentEditor.parameterValue.trim()) {
      setMessage("请选择参数名称并填写参数值。");
      return { type: "operation_error", reason: "invalid_parameter_editor" };
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/calculation-parameters", {
      method: currentEditor.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...currentEditor, scope: target.scope, targetId: target.target.id }),
    });
    const result = await response.json() as CalculationParameter & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.message === "parameter_code_exists" ? "当前对象下已存在相同参数编码。" : "保存失败，请检查输入。");
      return { type: "operation_error", reason: result.message ?? "save_failed" };
    }
    const nextItems = currentEditor.id
      ? itemsRef.current.map((item) => item.id === result.id ? result : item)
      : [...itemsRef.current, result];
    itemsRef.current = nextItems;
    setItems(nextItems);
    updateEditorOpen(false);
    setMessage("参数已保存。");
    return {
      type: "mutation_result",
      operation: currentEditor.id ? "update" : "create",
      success: true,
      item: result,
      listResult: buildParameterContext(target, nextItems),
    };
  }

  async function removeParameter(id: string) {
    setBusy(true);
    const response = await fetch(`/api/calculation-parameters?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setMessage("删除失败，请稍后重试。");
      return { type: "operation_error", reason: "delete_failed" };
    }
    const nextItems = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = nextItems;
    setItems(nextItems);
    updatePendingDeleteId(null);
    if (editorRef.current.id === id) updateEditorOpen(false);
    setMessage("参数已删除。");
    return {
      type: "mutation_result",
      operation: "delete",
      success: true,
      deletedId: id,
      listResult: configTargetRef.current ? buildParameterContext(configTargetRef.current, nextItems) : undefined,
    };
  }

  function getAvailableDefinitionOptions() {
    const target = configTargetRef.current;
    if (!target) return [];
    const currentEditor = editorRef.current;
    const targetParameters = itemsRef.current.filter((item) => item.scope === target.scope && item.targetId === target.target.id);
    return definitionsRef.current
      .filter((definition) => definition.applicableScopes.includes(target.scope))
      .filter((definition) => definition.parameterCode === currentEditor.definitionCode
        || !targetParameters.some((item) => item.parameterCode === definition.parameterCode))
      .map((definition) => ({ value: definition.parameterCode, label: definition.parameterName }));
  }

  useImperativeHandle(assistantRef, () => ({
    async setField(fieldId, value) {
      await dataReadyRef.current;
      if (fieldId === "policyNo") {
        const normalizedValue = value.toUpperCase();
        updatePolicyKeyword(normalizedValue);
        return { type: "field_updated", pageId: "calculation_config", fieldId, value: normalizedValue };
      }
      if (!editorOpenRef.current) return { type: "operation_error", reason: "editor_not_open", fieldId };
      if (fieldId === "definitionCode") {
        const definition = definitionsRef.current.find((item) => item.parameterCode === value);
        if (!definition || !getAvailableDefinitionOptions().some((option) => option.value === value)) {
          return { type: "operation_error", reason: "invalid_field_option", fieldId, value };
        }
        updateEditor((current) => ({
          ...current,
          definitionCode: value,
          parameterValue: definition.valueType === "boolean" ? "true" : "",
        }));
        return { type: "field_updated", pageId: "calculation_config", fieldId, value, valueType: definition.valueType, unit: definition.unit };
      }
      if (fieldId === "parameterValue") {
        updateEditor((current) => ({ ...current, parameterValue: value }));
        return { type: "field_updated", pageId: "calculation_config", fieldId, value };
      }
      if (fieldId === "description") {
        updateEditor((current) => ({ ...current, description: value }));
        return { type: "field_updated", pageId: "calculation_config", fieldId, value };
      }
      if (fieldId === "enabled") {
        if (value !== "true" && value !== "false") return { type: "operation_error", reason: "invalid_field_option", fieldId, value };
        updateEditor((current) => ({ ...current, enabled: value === "true" }));
        return { type: "field_updated", pageId: "calculation_config", fieldId, value };
      }
      return { type: "operation_error", reason: "field_executor_not_bound", fieldId };
    },
    async executeAction(actionId) {
      await dataReadyRef.current;
      if (actionId === "search") return searchPolicies();
      if (actionId === "reset") {
        updatePolicyKeyword("");
        updateSelectedPolicyId(null);
        updateConfigTarget(null);
        updateEditorOpen(false);
        updatePendingDeleteId(null);
        setSearched(false);
        setMessage("");
        return { type: "page_action", pageId: "calculation_config", actionId };
      }
      if (actionId === "create_parameter") return startCreate();
      if (actionId === "save_parameter") return saveParameter();
      if (actionId === "cancel_edit") {
        updateEditorOpen(false);
        return { type: "page_action", pageId: "calculation_config", actionId };
      }
      if (actionId === "back_to_objects") {
        updateConfigTarget(null);
        updateEditorOpen(false);
        setMessage("");
        const rows = buildHierarchyRows(catalogRef.current, selectedPolicyIdRef.current);
        return buildHierarchyContext(rows, itemsRef.current);
      }
      if (actionId === "confirm_delete_parameter") {
        const id = pendingDeleteIdRef.current;
        return id ? removeParameter(id) : { type: "operation_error", reason: "delete_confirmation_not_pending" };
      }
      if (actionId === "cancel_delete_parameter") {
        updatePendingDeleteId(null);
        return { type: "page_action", pageId: "calculation_config", actionId };
      }
      return { type: "operation_error", reason: "action_executor_not_bound", actionId };
    },
    async executeRowAction(actionId, row) {
      await dataReadyRef.current;
      if (actionId === "configure") {
        const hierarchyRow = buildHierarchyRows(catalogRef.current, selectedPolicyIdRef.current)[row - 1];
        return hierarchyRow
          ? openConfiguration(hierarchyRow)
          : { type: "operation_error", reason: "row_not_found", actionId, row };
      }
      const target = configTargetRef.current;
      if (!target) return { type: "operation_error", reason: "configuration_target_required" };
      const parameters = itemsRef.current.filter((item) => item.scope === target.scope && item.targetId === target.target.id);
      const item = parameters[row - 1];
      if (!item) return { type: "operation_error", reason: "row_not_found", actionId, row };
      if (actionId === "edit_parameter") return startEdit(item);
      if (actionId === "request_delete_parameter") {
        updatePendingDeleteId(item.id);
        return {
          type: "confirmation_required",
          pageId: "calculation_config",
          actionId: "confirm_delete_parameter",
          item: { id: item.id, parameterCode: item.parameterCode, parameterName: item.parameterName },
        };
      }
      return { type: "operation_error", reason: "row_action_executor_not_bound", actionId, row };
    },
    getRuntimeFieldOptions() {
      return { "calculation_config.definitionCode": getAvailableDefinitionOptions() };
    },
  }));

  if (configTarget) {
    return (
      <div className="calculation-config-page">
        <section className="panel config-page-header">
          <div className="config-page-heading">
            <span>{selectedPolicy?.policyNo} / {scopeLabels[configTarget.scope]}</span>
            <div className="section-title">{configTarget.target.name}</div>
            <div className="config-object-path" aria-label="对象路径">
              <small>路径：</small>
              {configTargetPath.map((node, index) => (
                <span className="config-object-path-node" key={`${node.scope}-${node.target.id}`}>
                  {index > 0 ? <i aria-hidden="true">/</i> : null}
                  <small>{scopeLabels[node.scope]} {node.target.name}（{node.target.code}）</small>
                </span>
              ))}
            </div>
          </div>
          <div className="page-header-actions">
            <button type="button" onClick={startCreate} disabled={busy}>新增参数</button>
            <button type="button" className="secondary-button" onClick={() => { updateConfigTarget(null); updateEditorOpen(false); setMessage(""); }}>返回对象列表</button>
          </div>
        </section>

        {editorOpen ? (
          <section className="panel config-editor-panel">
            <div className="panel-title-row">
              <div className="section-title">{editor.id ? "编辑参数" : "新增参数"}</div>
              <button type="button" className="secondary-button" onClick={() => updateEditorOpen(false)}>取消</button>
            </div>
            <div className="config-editor-grid">
              <label className="config-parameter-name-field"><span>参数名称</span><CustomDropdown value={editor.definitionCode} options={definitionOptions} onChange={(value) => {
                const definition = definitions.find((item) => item.parameterCode === value);
                updateEditor((current) => ({ ...current, definitionCode: value, parameterValue: definition?.valueType === "boolean" ? "true" : "" }));
              }} /></label>
              <div className="config-definition-meta">
                <span>值类型<strong>{selectedDefinition ? valueTypeLabel(selectedDefinition.valueType) : "-"}</strong></span>
                <span>默认单位<strong>{selectedDefinition?.unit ?? "无"}</strong></span>
              </div>
              <label>
                <span>参数值</span>
                {selectedDefinition?.valueType === "boolean"
                  ? <CustomDropdown value={editor.parameterValue as "true" | "false"} options={[{ value: "true", label: "是" }, { value: "false", label: "否" }]} onChange={(value) => updateEditor((current) => ({ ...current, parameterValue: value }))} />
                  : <input value={editor.parameterValue} onChange={(event) => updateEditor((current) => ({ ...current, parameterValue: event.target.value }))} placeholder="请输入参数值" />}
              </label>
              <label className="config-enabled-field"><span>状态</span><button type="button" className={`config-toggle ${editor.enabled ? "active" : ""}`} aria-pressed={editor.enabled} onClick={() => updateEditor((current) => ({ ...current, enabled: !current.enabled }))}><i />{editor.enabled ? "启用" : "停用"}</button></label>
              <label className="config-description-field"><span>参数说明</span><input value={editor.description} onChange={(event) => updateEditor((current) => ({ ...current, description: event.target.value }))} placeholder="说明该参数的计算口径和适用范围" /></label>
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
                        <span className="inline-confirm"><span>确认删除？</span><button type="button" className="danger-link" onClick={() => void removeParameter(item.id)} disabled={busy}>确认</button><button type="button" className="action-link" onClick={() => updatePendingDeleteId(null)}>取消</button></span>
                      ) : <><button type="button" className="action-link" onClick={() => startEdit(item)}>编辑</button><button type="button" className="danger-link" onClick={() => updatePendingDeleteId(item.id)}>删除</button></>}
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
            <input value={policyKeyword} onChange={(event) => updatePolicyKeyword(event.target.value.toUpperCase())} placeholder="请输入完整保单号，例如 GI2026000001" />
          </label>
          <button type="submit">查询</button>
          <button type="button" className="secondary-button" onClick={() => { updatePolicyKeyword(""); updateSelectedPolicyId(null); updateConfigTarget(null); setSearched(false); setMessage(""); }}>重置</button>
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
                  <table className="hierarchy-fixed-table calculation-hierarchy-table">
                    <thead><tr><th>层级</th><th>对象编码</th><th>对象名称</th><th>已配置参数</th><th className="actions-col">操作</th></tr></thead>
                    <tbody>{visibleHierarchyRows.map((row) => {
                      const configuredParameters = items.filter((item) => item.scope === row.scope && item.targetId === row.target.id);
                      return (
                        <tr key={row.key}>
                          <td>
                            <span className="config-tree-level" style={{ paddingLeft: `${row.level * 12}px` }}>
                              {row.hasChildren ? (
                                <button
                                  type="button"
                                  className="config-tree-toggle"
                                  aria-expanded={!collapsedHierarchyKeys.has(row.key)}
                                  aria-label={`${collapsedHierarchyKeys.has(row.key) ? "展开" : "收起"}${scopeLabels[row.scope]}${row.target.name}`}
                                  onClick={() => toggleHierarchyRow(row.key)}
                                >
                                  {collapsedHierarchyKeys.has(row.key) ? "▸" : "▾"}
                                </button>
                              ) : <span className="config-tree-toggle-placeholder" aria-hidden="true" />}
                              <span className={`config-level-badge ${row.scope}`}>{scopeLabels[row.scope]}</span>
                            </span>
                          </td>
                          <td><code style={{ marginLeft: `${row.level * 12}px` }}>{row.target.code}</code></td>
                          <td><span className="config-tree-name" style={{ paddingLeft: `${row.level * 18}px` }}>{row.target.name}</span></td>
                          <td>
                            {configuredParameters.length ? (
                              <div className="config-parameter-summary">
                                {configuredParameters.map((parameter) => (
                                  <span key={parameter.id}>
                                    <strong>{parameter.parameterName}：</strong>
                                    {parameter.valueType === "boolean"
                                      ? parameter.parameterValue === "true" ? "是" : "否"
                                      : parameter.parameterValue}
                                    {parameter.unit ? ` ${parameter.unit}` : ""}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="muted">未配置</span>}
                          </td>
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
});

export default CalculationConfigPage;
