"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import { apiFetch } from "../../src/api/client";
import type { AutomationValueType, BenefitFormulaView, CalculationVariableCategory, CalculationVariableView, FormulaStep } from "../../src/calculation/automation-types";
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

const variableCategoryLabels: Record<CalculationVariableCategory, string> = {
  bill: "账单参数",
  event: "事件参数",
  case: "案件参数",
  ledger: "台账参数",
  benefit: "责任参数",
  custom: "配置参数",
};

const fixedFormulaParameterOptions: Record<string, string[]> = {
  票据类型: ["门诊账单", "住院账单", "药店购药", "其他费用"],
  事件类型: ["疾病", "意外", "其他"],
  医保类型: ["城镇职工基本医疗保险", "城乡居民基本医疗保险", "新型农村合作医疗", "商业健康保险", "全自费", "其他"],
};

const emptyCustomVariable = {
  category: "bill" as CalculationVariableCategory,
  variableName: "",
  valueType: "number" as AutomationValueType,
  timeRange: "year" as "year" | "month" | "day",
  responsibilityRange: "benefit" as "benefit" | "product" | "plan" | "event",
  defaultValue: "",
};

function emptyFormulaStep(index: number): FormulaStep {
  return { id: String(index + 1), name: "", expression: "", result: false };
}

function formulaExpressionElements(expression: string, knownNames: string[]) {
  const names = [...new Set(knownNames.filter(Boolean))].sort((left, right) => right.length - left.length);
  const elements: string[] = [];
  let remaining = expression.trim();
  while (remaining) {
    const whitespace = remaining.match(/^\s+/)?.[0];
    if (whitespace) {
      remaining = remaining.slice(whitespace.length);
      continue;
    }
    const knownName = names.find((name) => remaining.startsWith(name));
    if (knownName) {
      elements.push(knownName);
      remaining = remaining.slice(knownName.length);
      continue;
    }
    const token = remaining.match(/^(?:>=|<=|!=|==|[≥≤≠=+\-*/><(),（）]|\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|并且|或者|最小|最大|绝对值|四舍五入|如果|否则|则|[^\s]+)/)?.[0];
    if (!token) break;
    elements.push(token);
    remaining = remaining.slice(token.length);
  }
  return elements;
}

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
  const [configurationView, setConfigurationView] = useState<"parameter" | "formula">("parameter");
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [collapsedHierarchyKeys, setCollapsedHierarchyKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [automationFormulas, setAutomationFormulas] = useState<BenefitFormulaView[]>([]);
  const [automationVariables, setAutomationVariables] = useState<CalculationVariableView[]>([]);
  const [formulaDraft, setFormulaDraft] = useState<BenefitFormulaView | null>(null);
  const [stepEditor, setStepEditor] = useState<FormulaStep>(() => emptyFormulaStep(0));
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [formulaMessage, setFormulaMessage] = useState("");
  const [customVariableOpen, setCustomVariableOpen] = useState(false);
  const [customVariable, setCustomVariable] = useState(emptyCustomVariable);
  const [draggedExpressionIndex, setDraggedExpressionIndex] = useState<number | null>(null);
  const [manualFormulaElement, setManualFormulaElement] = useState("");
  const [fixedParameterSelection, setFixedParameterSelection] = useState<{ variableName: string; options: string[] } | null>(null);
  const [fixedParameterOperator, setFixedParameterOperator] = useState<"" | "=" | "≠">("");
  const [fixedParameterValue, setFixedParameterValue] = useState("");
  const [activeFormulaEditor, setActiveFormulaEditor] = useState<"match" | "step">("step");
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
      const response = await apiFetch("/api/calculation-parameters", { cache: "no-store" });
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

  async function loadAutomation(policyId: string) {
    const response = await apiFetch(`/api/automatic-calculation?policyId=${encodeURIComponent(policyId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { formulas: BenefitFormulaView[]; variables: CalculationVariableView[] };
    setAutomationFormulas(data.formulas);
    setAutomationVariables(data.variables);
  }

  useEffect(() => {
    if (!configTarget || configTarget.scope !== "benefit") {
      setFormulaDraft(null);
      return;
    }
    const formula = automationFormulas.find((item) => item.benefitId === configTarget.target.id);
    if (formula) {
      const steps = formula.steps.map((step) => ({ ...step, ledgerTarget: step.ledgerTarget ? { ...step.ledgerTarget } : undefined }));
      if (steps.length && !steps.some((step) => step.result)) steps[steps.length - 1].result = true;
      setFormulaDraft({ ...formula, steps });
      setEditingStepIndex(null);
      setStepEditor(emptyFormulaStep(formula.steps.length));
      setActiveFormulaEditor("step");
    }
  }, [configTarget?.target.id, configTarget?.scope, automationFormulas]);

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
    void loadAutomation(matchedPolicy.id);
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

  const knownFormulaElementNames = [
    ...automationVariables.map((variable) => variable.variableName),
    ...(formulaDraft?.steps.map((step) => step.name) ?? []),
  ];

  function appendFormulaToken(token: string | string[]) {
    const tokens = Array.isArray(token) ? token : formulaExpressionElements(token, knownFormulaElementNames);
    if (activeFormulaEditor === "match") {
      setFormulaDraft((current) => {
        if (!current) return current;
        const currentElements = formulaExpressionElements(current.matchExpression, knownFormulaElementNames);
        return { ...current, matchExpression: [...currentElements, ...tokens].join(" ") };
      });
    } else {
      setStepEditor((current) => {
        const currentElements = formulaExpressionElements(current.expression, knownFormulaElementNames);
        return { ...current, expression: [...currentElements, ...tokens].join(" ") };
      });
    }
  }

  function selectFormulaVariable(variable: CalculationVariableView) {
    const options = fixedFormulaParameterOptions[variable.variableName]
      ?? (variable.valueType === "boolean" ? ["是", "否"] : undefined);
    if (!options) {
      appendFormulaToken(variable.variableName);
      return;
    }
    setFixedParameterSelection({ variableName: variable.variableName, options });
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
      setFormulaMessage("常数参数只能输入数字。");
      return;
    }
    appendFormulaToken(value);
    setManualFormulaElement("");
    setFormulaMessage("");
  }

  function moveFormulaElement(target: "match" | "step", fromIndex: number, toIndex: number, keepDragging = false) {
    const expression = target === "match" ? formulaDraft?.matchExpression ?? "" : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    if (fromIndex < 0 || fromIndex >= elements.length || toIndex < 0 || toIndex > elements.length) return;
    if (fromIndex === toIndex) return;
    const [moved] = elements.splice(fromIndex, 1);
    elements.splice(toIndex, 0, moved);
    if (target === "match") setFormulaDraft((current) => current ? { ...current, matchExpression: elements.join(" ") } : current);
    else setStepEditor((current) => ({ ...current, expression: elements.join(" ") }));
    setDraggedExpressionIndex(keepDragging ? Math.min(toIndex, elements.length - 1) : null);
  }

  function removeFormulaElement(target: "match" | "step", index: number) {
    const expression = target === "match" ? formulaDraft?.matchExpression ?? "" : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    elements.splice(index, 1);
    if (target === "match") setFormulaDraft((current) => current ? { ...current, matchExpression: elements.join(" ") } : current);
    else setStepEditor((current) => ({ ...current, expression: elements.join(" ") }));
    setDraggedExpressionIndex(null);
  }

  function renderFormulaExpressionEditor(target: "match" | "step", expression: string) {
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    return (
      <div
        className={`formula-expression-elements editable ${activeFormulaEditor === target ? "active-editor" : ""}`}
        onClick={() => setActiveFormulaEditor(target)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (draggedExpressionIndex !== null) moveFormulaElement(target, draggedExpressionIndex, elements.length);
        }}
      >
        {!expression.trim() ? <small className="formula-expression-empty">点击此处后，从上方选择参数和公式元素</small> : null}
        {elements.map((element, index) => (
          <i
            key={`${target}-formula-element-${index}`}
            className={draggedExpressionIndex === index && activeFormulaEditor === target ? "dragging" : ""}
            draggable
            title="拖动可修改顺序"
            onDragStart={(event) => {
              event.stopPropagation();
              setActiveFormulaEditor(target);
              setDraggedExpressionIndex(index);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragEnd={() => setDraggedExpressionIndex(null)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (activeFormulaEditor === target && draggedExpressionIndex !== null && draggedExpressionIndex !== index) {
                moveFormulaElement(target, draggedExpressionIndex, index, true);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDraggedExpressionIndex(null);
            }}
          >{element}</i>
        ))}
        <div
          className={`formula-expression-delete ${draggedExpressionIndex === null || activeFormulaEditor !== target ? "" : "active"}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (activeFormulaEditor === target && draggedExpressionIndex !== null) removeFormulaElement(target, draggedExpressionIndex);
          }}
        >拖到这里删除</div>
      </div>
    );
  }

  async function saveCurrentFormulaStep() {
    if (!formulaDraft || !stepEditor.name.trim() || !stepEditor.expression.trim()) {
      setFormulaMessage("请填写当前步骤名称和公式表达式。");
      return;
    }
    if (formulaDraft.steps.some((step, index) => index !== editingStepIndex && step.name.trim() === stepEditor.name.trim())) {
      setFormulaMessage("步骤名称不能重复。");
      return;
    }
    const nextStep = { ...stepEditor, name: stepEditor.name.trim(), expression: stepEditor.expression.trim() };
    const nextSteps = editingStepIndex === null
      ? [...formulaDraft.steps, nextStep]
      : formulaDraft.steps.map((step, index) => index === editingStepIndex ? nextStep : step);
    const normalizedSteps = editingStepIndex === null
      ? nextSteps.map((step, index) => ({ ...step, result: index === nextSteps.length - 1 }))
      : nextSteps.some((step) => step.result)
        ? nextSteps
        : nextSteps.map((step, index) => ({ ...step, result: index === nextSteps.length - 1 }));
    const nextDraft = { ...formulaDraft, steps: normalizedSteps };
    setFormulaDraft(nextDraft);
    if (!await saveFormula(nextDraft, "步骤和整套公式已保存。")) return;
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(nextSteps.length));
  }

  function editFormulaStep(index: number) {
    if (!formulaDraft) return;
    setEditingStepIndex(index);
    setStepEditor({ ...formulaDraft.steps[index], ledgerTarget: formulaDraft.steps[index].ledgerTarget ? { ...formulaDraft.steps[index].ledgerTarget } : undefined });
    setActiveFormulaEditor("step");
    setFormulaMessage("");
  }

  function editMatchStep() {
    setActiveFormulaEditor("match");
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(formulaDraft?.steps.length ?? 0));
    setFormulaMessage("");
  }

  async function finishMatchStep() {
    if (!formulaDraft) return;
    if (!formulaDraft.matchExpression.trim()) {
      await deleteFormulaConfiguration();
      return;
    }
    if (!await saveFormula(formulaDraft, "第一步和整套公式已保存。")) return;
    setActiveFormulaEditor("step");
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(formulaDraft.steps.length));
  }

  function cancelFormulaStepEditing() {
    setActiveFormulaEditor("step");
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(formulaDraft?.steps.length ?? 0));
    setFormulaMessage("");
  }

  function moveFormulaStep(index: number, direction: -1 | 1) {
    if (!formulaDraft) return;
    const target = index + direction;
    if (target < 0 || target >= formulaDraft.steps.length) return;
    const steps = [...formulaDraft.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setFormulaDraft({ ...formulaDraft, steps });
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(steps.length));
  }

  function selectFormulaResult(index: number) {
    setFormulaDraft((current) => current ? {
      ...current,
      steps: current.steps.map((step, stepIndex) => ({ ...step, result: stepIndex === index })),
    } : current);
  }

  function deleteFormulaStep(index: number) {
    setFormulaDraft((current) => {
      if (!current || current.steps.length <= 1) return current;
      const removedWasResult = current.steps[index]?.result;
      const steps = current.steps.filter((_, stepIndex) => stepIndex !== index);
      return {
        ...current,
        steps: removedWasResult
          ? steps.map((step, stepIndex) => ({ ...step, result: stepIndex === steps.length - 1 }))
          : steps,
      };
    });
  }

  async function saveFormula(draftOverride?: BenefitFormulaView, successMessage = "公式已保存，可在案件理算中直接执行。") {
    const draft = draftOverride ?? formulaDraft;
    if (!draft) return false;
    if (!draft.matchExpression.trim()) {
      await deleteFormulaConfiguration();
      return false;
    }
    setBusy(true);
    setFormulaMessage("");
    const response = await apiFetch("/api/automatic-calculation/formulas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const result = await response.json() as BenefitFormulaView & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setFormulaMessage(result.message === "formula_match_expression_required"
        ? "第一步自动匹配条件为必录项，请配置后再保存。"
        : result.message === "formula_result_step_required"
          ? "请将其中一个步骤标记为公式结果。"
          : result.message === "formula_step_name_duplicate"
          ? "步骤名称不能重复。"
          : result.message === "formula_step_name_conflict"
            ? "步骤名称不能与账单、事件、台账、责任或自定义参数名称重复。"
            : result.message === "formula_step_dependency_order_invalid"
              ? "步骤顺序无效：当前步骤引用了排在它后面的步骤，请调整顺序。"
          : `公式保存失败：${result.message ?? "请检查表达式"}`);
      return false;
    }
    const next = automationFormulas.map((item) => item.benefitId === result.benefitId ? { ...draft, ...result } : item);
    setAutomationFormulas(next);
    setFormulaDraft({ ...draft, ...result });
    setFormulaMessage(successMessage);
    return true;
  }

  async function deleteFormulaConfiguration() {
    if (!selectedPolicy || !formulaDraft || configTarget?.scope !== "benefit") return false;
    setBusy(true);
    const response = await apiFetch(`/api/automatic-calculation/formulas?policyId=${encodeURIComponent(selectedPolicy.id)}&benefitId=${encodeURIComponent(configTarget.target.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setFormulaMessage("公式删除失败，请稍后重试。");
      return false;
    }
    const cleared: BenefitFormulaView = {
      ...formulaDraft,
      id: undefined,
      matchExpression: "",
      steps: [],
      updatedAt: undefined,
      enabled: true,
    };
    setAutomationFormulas((items) => items.map((item) => item.benefitId === cleared.benefitId ? cleared : item));
    setFormulaDraft(cleared);
    setActiveFormulaEditor("match");
    setEditingStepIndex(null);
    setStepEditor(emptyFormulaStep(0));
    setFormulaMessage("公式已删除，该责任公式步骤数为 0。");
    return true;
  }

  async function saveCustomVariable() {
    if (!selectedPolicy || !customVariable.variableName.trim()) {
      setFormulaMessage("请填写自定义参数名称。");
      return;
    }
    setBusy(true);
    const response = await apiFetch("/api/automatic-calculation/variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...customVariable, policyId: selectedPolicy.id, enabled: true }),
    });
    const result = await response.json() as CalculationVariableView & { message?: string };
    setBusy(false);
    if (!response.ok) {
      const errorMessage = result.message === "variable_name_exists"
        ? "新增失败：同一保单下参数名称不能重复。"
        : result.message === "ledger_name_reserved"
          ? "免赔额、给付金额为内置台账名称，不能重复新增。"
          : result.message === "ledger_scope_required"
            ? "请同时选择台账的时间范围和责任范围。"
            : `自定义参数保存失败：${result.message ?? "请检查填写内容"}`;
      setFormulaMessage(errorMessage);
      return;
    }
    setAutomationVariables((items) => [...items, result]);
    setCustomVariable(emptyCustomVariable);
    setCustomVariableOpen(false);
    setFormulaMessage("自定义参数已新增；账单参数会同步出现在账单录入页面。");
  }

  function openConfiguration(row: ConfigTarget, view: "parameter" | "formula" = "parameter") {
    if (view === "formula" && row.scope !== "benefit") return;
    setConfigurationView(view);
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

  async function saveParameter(operationId?: string) {
    const target = configTargetRef.current;
    const currentEditor = editorRef.current;
    if (!target || !currentEditor.definitionCode || !currentEditor.parameterValue.trim()) {
      setMessage("请选择参数名称并填写参数值。");
      return { type: "operation_error", reason: "invalid_parameter_editor" };
    }
    setBusy(true);
    setMessage("");
    const response = await apiFetch("/api/calculation-parameters", {
      method: currentEditor.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": operationId ?? crypto.randomUUID() },
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

  async function removeParameter(id: string, operationId?: string) {
    setBusy(true);
    const response = await apiFetch(`/api/calculation-parameters?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": operationId ?? crypto.randomUUID() },
    });
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
    async executeAction(actionId, options) {
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
      if (actionId === "save_parameter") return saveParameter(options?.operationId);
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
        return id ? removeParameter(id, options?.operationId) : { type: "operation_error", reason: "delete_confirmation_not_pending" };
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
            <span>{selectedPolicy?.policyNo} / {scopeLabels[configTarget.scope]} / {configurationView === "parameter" ? "参数配置" : "公式配置"}</span>
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
            {configurationView === "parameter" ? <button type="button" onClick={startCreate} disabled={busy}>新增参数</button> : null}
            {configurationView === "formula" ? <button type="button" className="danger-button" onClick={() => void deleteFormulaConfiguration()} disabled={busy}>删除公式</button> : null}
            <button type="button" className="page-back-button" onClick={() => { updateConfigTarget(null); updateEditorOpen(false); setConfigurationView("parameter"); setMessage(""); }}>返回上一页</button>
          </div>
        </section>

        {configurationView === "parameter" && editorOpen ? (
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

        {configurationView === "formula" && configTarget.scope === "benefit" && formulaDraft ? (
          <>
            <section className="panel formula-parameter-library">
              <div className="panel-title-row">
                <div>
                  <div className="section-title">公式参数库</div>
                  <small className="muted">按分类下拉选择参数，选中后自动追加到正在操作的公式步骤</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => setCustomVariableOpen((open) => !open)}>新增自定义参数</button>
              </div>
              <div className="formula-variable-groups">
                {(Object.keys(variableCategoryLabels) as CalculationVariableCategory[]).map((category) => {
                  const categoryVariables = automationVariables.filter((item) => item.category === category && (category !== "benefit" || item.benefitId === configTarget.target.id));
                  if (!categoryVariables.length) return null;
                  return (
                    <div key={category}>
                      <strong>{variableCategoryLabels[category]}</strong>
                      <select value="" onChange={(event) => {
                        const variable = categoryVariables.find((item) => item.variableName === event.target.value);
                        if (variable) selectFormulaVariable(variable);
                      }}>
                        <option value="">请选择{variableCategoryLabels[category]}</option>
                        {categoryVariables.map((variable) => <option key={`${category}-${variable.id ?? variable.variableName}-${variable.benefitId ?? ""}`} value={variable.variableName}>{variable.variableName}</option>)}
                      </select>
                    </div>
                  );
                })}
                {activeFormulaEditor === "step" && formulaDraft.steps.length ? <div><strong>已添加步骤</strong><select value="" onChange={(event) => { if (event.target.value) appendFormulaToken(event.target.value); }}><option value="">请选择已有步骤</option>{formulaDraft.steps.slice(0, editingStepIndex ?? formulaDraft.steps.length).map((step, index) => <option key={`${step.id}-${index}`} value={step.name}>{step.name}</option>)}</select></div> : null}
              </div>
              <div className="formula-library-tools">
                <div className="formula-library-tools-heading">
                  <div><strong>符号、逻辑与常数</strong><small>当前加入到：<b>{activeFormulaEditor === "match" ? "第一步 · 自动匹配条件" : editingStepIndex === null ? "新增公式步骤" : `第 ${editingStepIndex + 2} 步`}</b></small></div>
                  <span>先点击下方自动匹配条件或公式表达式，可切换加入位置</span>
                </div>
                <div className="formula-library-tools-content">
                  <div className="formula-tool-group">
                    <strong>符号与逻辑</strong>
                    <div>{["+", "-", "*", "/", "(", ")", "并且", "或者", "=", "≠", ">", "<", "≥", "≤", "最小(", "最大("].map((operator) => <button type="button" key={operator} onClick={() => appendFormulaToken(operator)}>{operator}</button>)}<button type="button" onClick={() => appendFormulaToken(["如果", "(", ")", "则", "(", ")", "否则", "(", ")"])}>如果（ ）则（ ）否则（ ）</button></div>
                  </div>
                  <div className="formula-tool-group formula-constant-group">
                    <strong>常数参数</strong>
                    <div><input type="number" step="any" value={manualFormulaElement} onChange={(event) => setManualFormulaElement(event.target.value)} placeholder="例如 100、0.8" /><button type="button" onClick={appendNumericConstant}>加入常数</button></div>
                  </div>
                </div>
              </div>
              {customVariableOpen ? (
                <div className="formula-custom-variable-editor">
                  <label><span>参数分类</span><CustomDropdown value={customVariable.category} options={(Object.keys(variableCategoryLabels) as CalculationVariableCategory[]).filter((value) => value !== "benefit").map((value) => ({ value, label: variableCategoryLabels[value] }))} onChange={(category) => setCustomVariable((current) => ({ ...current, category }))} /></label>
                  {customVariable.category === "ledger" ? <><label><span>时间范围</span><CustomDropdown value={customVariable.timeRange} options={[{ value: "year", label: "年" }, { value: "month", label: "月" }, { value: "day", label: "日" }]} onChange={(timeRange) => setCustomVariable((current) => ({ ...current, timeRange }))} /></label><label><span>责任范围</span><CustomDropdown value={customVariable.responsibilityRange} options={[{ value: "benefit", label: "责任" }, { value: "product", label: "险种" }, { value: "plan", label: "保障计划" }, { value: "event", label: "事件" }]} onChange={(responsibilityRange) => setCustomVariable((current) => ({ ...current, responsibilityRange }))} /></label></> : null}
                  <label><span>{customVariable.category === "ledger" ? "台账名称" : "参数名称"}</span><input value={customVariable.variableName} onChange={(event) => setCustomVariable((current) => ({ ...current, variableName: event.target.value }))} placeholder={customVariable.category === "ledger" ? "例如住院次数" : "例如实际住院天数"} /></label>
                  <label><span>值类型</span><CustomDropdown value={customVariable.valueType as "number" | "boolean"} options={[{ value: "number", label: "数值" }, { value: "boolean", label: "是/否" }]} onChange={(valueType) => setCustomVariable((current) => ({ ...current, valueType }))} /></label>
                  <label><span>默认值</span>{customVariable.valueType === "boolean" ? <CustomDropdown value={(customVariable.defaultValue || "false") as "true" | "false"} options={[{ value: "true", label: "是" }, { value: "false", label: "否" }]} onChange={(defaultValue) => setCustomVariable((current) => ({ ...current, defaultValue }))} /> : <input type="number" step="any" value={customVariable.defaultValue} onChange={(event) => setCustomVariable((current) => ({ ...current, defaultValue: event.target.value }))} />}</label>
                  {customVariable.category === "ledger" ? <small className="formula-ledger-name-tip">免赔额、给付金额为内置名称，不可重复。</small> : null}
                  <button type="button" onClick={() => void saveCustomVariable()} disabled={busy}>保存自定义参数</button>
                </div>
              ) : null}
            </section>

            <section className="panel formula-editor-panel">
              <div className="formula-step-operation">
                <div className="formula-step-control-row">
                  <label><span>步骤名称</span><input value={activeFormulaEditor === "match" ? "自动匹配条件" : stepEditor.name} disabled={activeFormulaEditor === "match"} onChange={(event) => setStepEditor((current) => ({ ...current, name: event.target.value }))} placeholder="请输入中文步骤名称" /></label>
                  <label><span>累计台账</span><select value={activeFormulaEditor === "match" ? "" : stepEditor.ledgerTarget?.code ?? ""} disabled={activeFormulaEditor === "match"} onChange={(event) => {
                    const code = event.target.value;
                    const names: Record<string, string> = { annual_deductible: "累计免赔额", annual_payment: "累计给付金额" };
                    setStepEditor((current) => ({ ...current, ledgerTarget: code ? { code, name: names[code] } : undefined }));
                  }}><option value="">不累计</option><option value="annual_deductible">累计免赔额</option><option value="annual_payment">累计给付金额</option></select></label>
                  <div className="formula-step-inline-actions"><button type="button" className="secondary-button" onClick={cancelFormulaStepEditing}>取消</button><button type="button" disabled={busy} onClick={activeFormulaEditor === "match" ? finishMatchStep : saveCurrentFormulaStep}>保存</button></div>
                </div>
                <div className="formula-step-expression">
                  <span>公式表达式</span>
                  {renderFormulaExpressionEditor(activeFormulaEditor, activeFormulaEditor === "match" ? formulaDraft.matchExpression : stepEditor.expression)}
                </div>
              </div>

              <div className="table-wrapper formula-step-table">
                <table>
                  <thead><tr><th>顺序</th><th>步骤名称</th><th>公式表达式</th><th>公式结果</th><th>累计台账</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr className="formula-match-fixed-row" onDoubleClick={editMatchStep}>
                      <td><strong>1</strong></td>
                      <td><strong>自动匹配条件</strong><small className="table-description">必录 · 固定第一步</small></td>
                      <td><div className="formula-expression-elements formula-expression-view">{formulaExpressionElements(formulaDraft.matchExpression, knownFormulaElementNames).map((element, elementIndex) => <i key={`${element}-${elementIndex}`}>{element}</i>)}</div></td>
                      <td>-</td>
                      <td>-</td>
                      <td className="formula-step-actions"><button type="button" className="action-link" onClick={editMatchStep}>修改</button></td>
                    </tr>
                    {formulaDraft.steps.map((step, index) => (
                    <tr
                      key={`${step.id}-${index}`}
                      className={step.result ? "formula-result-row" : ""}
                      aria-selected={step.result}
                      onDoubleClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, label, input, select")) return;
                        editFormulaStep(index);
                      }}
                    >
                      <td><strong>{index + 2}</strong></td>
                      <td><strong>{step.name}</strong></td>
                      <td><div className="formula-expression-elements formula-expression-view">{formulaExpressionElements(step.expression, knownFormulaElementNames).map((element, elementIndex) => <i key={`${element}-${elementIndex}`}>{element}</i>)}</div></td>
                      <td><label className="formula-result-radio"><input type="checkbox" checked={step.result} onChange={() => selectFormulaResult(index)} /><i className="formula-result-checkbox" aria-hidden="true" /><span>公式结果</span></label></td>
                      <td>{step.ledgerTarget?.name ?? "不累计"}</td>
                      <td className="formula-step-actions"><button type="button" className="action-link" onClick={() => editFormulaStep(index)}>修改</button><button type="button" className="action-link" disabled={index === 0} onClick={() => moveFormulaStep(index, -1)}>上移</button><button type="button" className="action-link" disabled={index === formulaDraft.steps.length - 1} onClick={() => moveFormulaStep(index, 1)}>下移</button><button type="button" className="danger-link" disabled={formulaDraft.steps.length <= 1} onClick={() => deleteFormulaStep(index)}>删除</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {formulaMessage ? <div className={`config-message ${formulaMessage.includes("已") ? "success" : ""}`}>{formulaMessage}</div> : null}
            </section>
          </>
        ) : null}

        {configurationView === "formula" && fixedParameterSelection ? (
          <div className="formula-fixed-parameter-overlay" role="presentation">
            <div className="formula-fixed-parameter-dialog" role="dialog" aria-modal="true" aria-labelledby="fixed-parameter-title">
              <div className="panel-title-row">
                <div>
                  <div className="section-title" id="fixed-parameter-title">配置固定选项参数</div>
                  <small className="muted">{fixedParameterSelection.variableName} 必须同时选择判断符号和参数值</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => setFixedParameterSelection(null)}>取消</button>
              </div>
              <div className="formula-fixed-parameter-fields">
                <label><span>参数名称</span><strong>{fixedParameterSelection.variableName}</strong></label>
                <label><span>判断符号</span><select value={fixedParameterOperator} onChange={(event) => setFixedParameterOperator(event.target.value as "" | "=" | "≠")}><option value="">请选择</option><option value="=">等于（=）</option><option value="≠">不等于（≠）</option></select></label>
                <label><span>参数值</span><select value={fixedParameterValue} onChange={(event) => setFixedParameterValue(event.target.value)}><option value="">请选择</option>{fixedParameterSelection.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              </div>
              <div className="formula-fixed-parameter-actions"><button type="button" disabled={!fixedParameterOperator || !fixedParameterValue} onClick={confirmFixedParameterSelection}>确认加入公式</button></div>
            </div>
          </div>
        ) : null}

        {configurationView === "parameter" ? <section className="panel config-table-panel">
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
        </section> : null}
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
                    <thead><tr><th>层级 / 对象名称</th><th>对象编码</th><th>已配置参数</th><th>公式</th><th className="actions-col">操作</th></tr></thead>
                    <tbody>{visibleHierarchyRows.map((row) => {
                      const configuredParameters = items.filter((item) => item.scope === row.scope && item.targetId === row.target.id);
                      const configuredFormula = row.scope === "benefit" ? automationFormulas.find((formula) => formula.benefitId === row.target.id && formula.id) : undefined;
                      return (
                        <tr key={row.key}>
                          <td>
                            <span className="config-tree-object" style={{ paddingLeft: `${row.level * 18}px` }}>
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
                              <strong className="config-tree-name">{row.target.name}</strong>
                            </span>
                          </td>
                          <td><code>{row.target.code}</code></td>
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
                          <td>{configuredFormula ? <span className="formula-step-count">{configuredFormula.steps.length + 1} 步</span> : <span className="muted">-</span>}</td>
                          <td className="actions-cell"><button type="button" className="action-link" onClick={() => openConfiguration(row, "parameter")}>参数</button><button type="button" className="action-link" disabled={row.scope !== "benefit"} onClick={() => openConfiguration(row, "formula")}>公式</button></td>
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
