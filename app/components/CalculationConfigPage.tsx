"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import { apiFetch } from "../../src/api/client";
import type { BenefitFormulaView, CalculationVariableCategory, CalculationVariableView, FormulaStep, FormulaValidationResult, StandardFormulaView } from "../../src/calculation/automation-types";
import type {
  CalculationConfigCatalog,
  CalculationParameter,
  CalculationParameterDefinition,
  Policy,
} from "../../src/underwriting/types";
import { sortCalculationParameters } from "../../src/underwriting/calculation-parameter-order";
import { placeFormulaStep } from "../../src/calculation/formula-step-order";
import {
  buildHierarchyContext,
  buildHierarchyRows,
  buildParameterContext,
  buildTargetPath,
  CustomDropdown,
  emptyCatalog,
  emptyCustomVariable,
  emptyEditor,
  emptyFormulaStep,
  formatPolicyStatus,
  formulaDragMime,
  formulaExpressionElements,
  formulaVariableOptionLabel,
  isNewConfigurationParameterName,
  scopeLabels,
  valueTypeLabel,
  variableCategoryLabels,
  type ConfigTarget,
  type EditorState,
  type Option,
} from "./CalculationConfigSupport";

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
  const [standardFormulas, setStandardFormulas] = useState<StandardFormulaView[]>([]);
  const [selectedStandardFormulaId, setSelectedStandardFormulaId] = useState("");
  const [automationVariables, setAutomationVariables] = useState<CalculationVariableView[]>([]);
  const [formulaDraft, setFormulaDraft] = useState<BenefitFormulaView | null>(null);
  const [stepEditor, setStepEditor] = useState<FormulaStep>(() => emptyFormulaStep(0));
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [formulaMessage, setFormulaMessage] = useState("");
  const [formulaValidationOpen, setFormulaValidationOpen] = useState(false);
  const [formulaValidationInputs, setFormulaValidationInputs] = useState<Record<string, string>>({});
  const [formulaValidationResult, setFormulaValidationResult] = useState<FormulaValidationResult | null>(null);
  const [formulaValidationMessage, setFormulaValidationMessage] = useState("");
  const [customVariableOpen, setCustomVariableOpen] = useState(false);
  const [customVariable, setCustomVariable] = useState(emptyCustomVariable);
  const [draggedExpressionIndex, setDraggedExpressionIndex] = useState<number | null>(null);
  const [draggedLibraryTokens, setDraggedLibraryTokens] = useState<string[] | null>(null);
  const [formulaDropTarget, setFormulaDropTarget] = useState<{ target: "match" | "step"; index: number } | null>(null);
  const draggedExpressionIndexRef = useRef<number | null>(null);
  const draggedExpressionTargetRef = useRef<"match" | "step" | null>(null);
  const draggedLibraryTokensRef = useRef<string[] | null>(null);
  const formulaDropTargetRef = useRef<{ target: "match" | "step"; index: number } | null>(null);
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
      if (!response.ok) throw new Error("calculation_parameters_load_failed");
      const data = await response.json() as {
        catalog: CalculationConfigCatalog;
        policies: Policy[];
        items: CalculationParameter[];
        definitions: CalculationParameterDefinition[];
      };
      const nextCatalog = data.catalog ?? emptyCatalog;
      const nextPolicies = Array.isArray(data.policies) ? data.policies : [];
      const nextItems = Array.isArray(data.items) ? data.items : [];
      const nextDefinitions = Array.isArray(data.definitions) ? data.definitions : [];
      catalogRef.current = nextCatalog;
      policiesRef.current = nextPolicies;
      itemsRef.current = nextItems;
      definitionsRef.current = nextDefinitions;
      setCatalog(nextCatalog);
      setPolicies(nextPolicies);
      setItems(nextItems);
      setDefinitions(nextDefinitions);
    })().catch(() => {
      catalogRef.current = emptyCatalog;
      policiesRef.current = [];
      itemsRef.current = [];
      definitionsRef.current = [];
      setCatalog(emptyCatalog);
      setPolicies([]);
      setItems([]);
      setDefinitions([]);
    });
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
    const data = await response.json() as { formulas: BenefitFormulaView[]; standardFormulas: StandardFormulaView[]; variables: CalculationVariableView[] };
    setAutomationFormulas(data.formulas);
    setStandardFormulas(data.standardFormulas ?? []);
    setAutomationVariables(data.variables);
  }

  useEffect(() => {
    if (!configTarget || configTarget.scope !== "benefit") {
      setFormulaDraft(null);
      setFormulaValidationOpen(false);
      setFormulaValidationResult(null);
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
      setFormulaValidationOpen(false);
      setFormulaValidationResult(null);
      setFormulaValidationMessage("");
    }
  }, [configTarget?.target.id, configTarget?.scope, automationFormulas]);

  useEffect(() => {
    setFormulaValidationResult(null);
    setFormulaValidationMessage("");
  }, [formulaDraft?.matchExpression, formulaDraft?.steps]);

  const visibleParameters = configTarget
    ? sortCalculationParameters(items.filter((item) => item.scope === configTarget.scope && item.targetId === configTarget.target.id))
    : [];
  const configTargetPath = configTarget ? buildTargetPath(catalog, configTarget) : [];
  const selectedDefinition = definitions.find((definition) => definition.parameterCode === editor.definitionCode);
  const definitionOptions: Option<string>[] = configTarget
    ? definitions
      .filter((definition) => definition.applicableScopes.includes(configTarget.scope))
      .filter((definition) => Boolean(editor.id) || isNewConfigurationParameterName(definition.parameterName))
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

  const formulaLibraryVariables = automationVariables.filter((variable) => variable.valueType !== "date");
  const formulaLocked = Boolean(formulaDraft?.standardFormulaId);
  const knownFormulaElementNames = [
    ...formulaLibraryVariables.map((variable) => variable.formulaName ?? variable.variableName),
    ...(formulaDraft?.steps.map((step) => step.name) ?? []),
  ];
  const formulaValidationVariables = (() => {
    if (!formulaDraft || configTarget?.scope !== "benefit") return [];
    const availableVariables = formulaLibraryVariables.filter((variable) =>
      variable.category !== "benefit" || variable.benefitId === configTarget.target.id,
    );
    const usedElements = new Set(
      [formulaDraft.matchExpression, ...formulaDraft.steps.map((step) => step.expression)]
        .flatMap((expression) => formulaExpressionElements(expression, knownFormulaElementNames)),
    );
    const unique = new Map<string, CalculationVariableView>();
    for (const variable of availableVariables) {
      const name = variable.formulaName ?? variable.variableName;
      if (usedElements.has(name) && !unique.has(name)) unique.set(name, variable);
    }
    return [...unique.values()];
  })();

  function openFormulaValidation() {
    if (!formulaDraft?.matchExpression.trim()) {
      setFormulaMessage("请先配置并保存自动匹配条件，再进行验算。");
      return;
    }
    if (!formulaDraft.steps.length) {
      setFormulaMessage("请先保存至少一个公式步骤，再进行验算。");
      return;
    }
    setFormulaValidationInputs((current) => Object.fromEntries(formulaValidationVariables.map((variable) => {
      const name = variable.formulaName ?? variable.variableName;
      const initial = current[name] ?? variable.defaultValue ?? (variable.valueType === "boolean" ? "false" : "");
      return [name, initial];
    })));
    setFormulaValidationResult(null);
    setFormulaValidationMessage("");
    setFormulaValidationOpen(true);
  }

  function updateFormulaValidationInput(name: string, value: string) {
    setFormulaValidationInputs((current) => ({ ...current, [name]: value }));
    setFormulaValidationResult(null);
    setFormulaValidationMessage("");
  }

  async function runFormulaValidation() {
    if (!formulaDraft) return;
    const missing = formulaValidationVariables.find((variable) => {
      const name = variable.formulaName ?? variable.variableName;
      return formulaValidationInputs[name]?.trim() === "";
    });
    if (missing) {
      setFormulaValidationMessage(`请输入“${missing.formulaName ?? missing.variableName}”。`);
      return;
    }
    const variables = Object.fromEntries(formulaValidationVariables.map((variable) => {
      const name = variable.formulaName ?? variable.variableName;
      const rawValue = formulaValidationInputs[name] ?? "";
      const value = ["number", "amount", "percentage"].includes(variable.valueType)
        ? Number(rawValue)
        : variable.valueType === "boolean"
          ? rawValue === "true"
          : rawValue;
      return [name, value];
    }));
    if (Object.values(variables).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      setFormulaValidationMessage("数值参数格式不正确，请检查后重新验算。");
      return;
    }
    setBusy(true);
    setFormulaValidationMessage("");
    const response = await apiFetch("/api/automatic-calculation/formulas/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchExpression: formulaDraft.matchExpression,
        steps: formulaDraft.steps,
        variables,
      }),
    });
    const result = await response.json() as FormulaValidationResult & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setFormulaValidationResult(null);
      setFormulaValidationMessage(`验算失败：${result.message ?? "请检查公式和输入参数"}`);
      return;
    }
    setFormulaValidationResult(result);
    setFormulaValidationMessage("验算完成。");
  }

  function displayValidationValue(value: number | boolean | string | undefined) {
    if (value === undefined) return "-";
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
    return value;
  }

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
    const options = variable.options
      ?? (variable.valueType === "boolean" ? ["是", "否"] : undefined);
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
      setFormulaMessage("常数参数只能输入数字。");
      return;
    }
    appendFormulaToken(value);
    setManualFormulaElement("");
    setFormulaMessage("");
  }

  function setFormulaExpression(target: "match" | "step", elements: string[]) {
    const expression = elements.join(" ");
    if (target === "match") setFormulaDraft((current) => current ? { ...current, matchExpression: expression } : current);
    else setStepEditor((current) => ({ ...current, expression }));
  }

  function insertFormulaElements(target: "match" | "step", tokens: string[], index: number) {
    const expression = target === "match" ? formulaDraft?.matchExpression ?? "" : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    elements.splice(Math.max(0, Math.min(index, elements.length)), 0, ...tokens);
    setFormulaExpression(target, elements);
  }

  function moveFormulaElement(target: "match" | "step", fromIndex: number, insertionIndex: number) {
    const expression = target === "match" ? formulaDraft?.matchExpression ?? "" : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    if (fromIndex < 0 || fromIndex >= elements.length || insertionIndex < 0 || insertionIndex > elements.length) return;
    const [moved] = elements.splice(fromIndex, 1);
    const adjustedIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
    elements.splice(Math.max(0, Math.min(adjustedIndex, elements.length)), 0, moved);
    setFormulaExpression(target, elements);
  }

  function removeFormulaElement(target: "match" | "step", index: number) {
    const expression = target === "match" ? formulaDraft?.matchExpression ?? "" : stepEditor.expression;
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    elements.splice(index, 1);
    setFormulaExpression(target, elements);
    setDraggedExpressionIndex(null);
    formulaDropTargetRef.current = null;
    setFormulaDropTarget(null);
  }

  function beginLibraryElementDrag(event: ReactDragEvent<HTMLElement>, tokens: string[]) {
    draggedExpressionIndexRef.current = null;
    draggedExpressionTargetRef.current = null;
    draggedLibraryTokensRef.current = tokens;
    setDraggedLibraryTokens(tokens);
    formulaDropTargetRef.current = null;
    setFormulaDropTarget(null);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(formulaDragMime, JSON.stringify({ kind: "library", tokens }));
    event.dataTransfer.setData("text/plain", tokens.join(" "));
  }

  function finishFormulaDrag() {
    draggedExpressionIndexRef.current = null;
    draggedExpressionTargetRef.current = null;
    draggedLibraryTokensRef.current = null;
    setDraggedExpressionIndex(null);
    setDraggedLibraryTokens(null);
    formulaDropTargetRef.current = null;
    setFormulaDropTarget(null);
  }

  function updateFormulaDropTarget(target: "match" | "step", index: number) {
    formulaDropTargetRef.current = { target, index };
    setFormulaDropTarget((current) =>
      current?.target === target && current.index === index ? current : { target, index },
    );
  }

  function locateFormulaDropIndex(event: ReactDragEvent<HTMLDivElement>, elementCount: number) {
    const positions = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(":scope > i[data-formula-index]"))
      .map((node) => ({
        index: Number(node.dataset.formulaIndex),
        rect: node.getBoundingClientRect(),
      }))
      .filter((item) => Number.isInteger(item.index));
    if (!positions.length) return 0;
    const row = positions.filter(({ rect }) => event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4);
    if (row.length) {
      const before = row.find(({ rect }) => event.clientX < rect.left + rect.width / 2);
      return before?.index ?? Math.min(elementCount, row[row.length - 1].index + 1);
    }
    const nextRow = positions.find(({ rect }) => event.clientY < rect.top);
    return nextRow?.index ?? elementCount;
  }

  function dropFormulaElements(target: "match" | "step", insertionIndex: number, event?: ReactDragEvent<HTMLElement>) {
    setActiveFormulaEditor(target);
    let payload: { kind?: string; target?: "match" | "step"; index?: number; tokens?: string[] } = {};
    try {
      payload = JSON.parse(event?.dataTransfer.getData(formulaDragMime) || "{}") as typeof payload;
    } catch {
      payload = {};
    }
    const libraryTokens = draggedLibraryTokensRef.current ?? payload.tokens ?? null;
    const expressionIndex = draggedExpressionIndexRef.current ?? (payload.kind === "expression" ? payload.index ?? null : null);
    const expressionTarget = draggedExpressionTargetRef.current ?? payload.target ?? null;
    if (libraryTokens?.length) insertFormulaElements(target, libraryTokens, insertionIndex);
    else if (expressionIndex !== null && expressionTarget === target) moveFormulaElement(target, expressionIndex, insertionIndex);
    finishFormulaDrag();
  }

  function renderFormulaExpressionEditor(target: "match" | "step", expression: string) {
    const elements = formulaExpressionElements(expression, knownFormulaElementNames);
    const dragActive = draggedExpressionIndex !== null || draggedLibraryTokens !== null;
    return (
      <div className="formula-expression-editor-stack">
        <div
          className={`formula-expression-elements editable ${activeFormulaEditor === target ? "active-editor" : ""}`}
          onClick={() => setActiveFormulaEditor(target)}
          onDragOver={(event) => {
            if (!dragActive && !event.dataTransfer.types.includes(formulaDragMime)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = draggedLibraryTokens ? "copy" : "move";
            updateFormulaDropTarget(target, locateFormulaDropIndex(event, elements.length));
          }}
          onDrop={(event) => {
            event.preventDefault();
            const dropTarget = formulaDropTargetRef.current;
            dropFormulaElements(target, dropTarget?.target === target ? dropTarget.index : elements.length, event);
          }}
        >
          {!expression.trim() ? <small className="formula-expression-empty">点击此处后，从上方选择参数和公式元素</small> : null}
          {elements.map((element, index) => (
            <i
              key={`${target}-formula-element-${index}-${element}`}
              data-formula-index={index}
              className={[
                draggedExpressionIndex === index && activeFormulaEditor === target ? "dragging" : "",
                formulaDropTarget?.target === target && formulaDropTarget.index === index && dragActive ? "formula-drop-before" : "",
                formulaDropTarget?.target === target && formulaDropTarget.index === elements.length && index === elements.length - 1 && dragActive ? "formula-drop-after" : "",
              ].filter(Boolean).join(" ")}
              draggable
              title="拖动可修改顺序"
              onDragStart={(event) => {
                event.stopPropagation();
                setActiveFormulaEditor(target);
                draggedExpressionIndexRef.current = index;
                draggedExpressionTargetRef.current = target;
                draggedLibraryTokensRef.current = null;
                setDraggedLibraryTokens(null);
                setDraggedExpressionIndex(index);
                formulaDropTargetRef.current = { target, index };
                setFormulaDropTarget({ target, index });
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(formulaDragMime, JSON.stringify({ kind: "expression", target, index }));
                event.dataTransfer.setData("text/plain", element);
              }}
              onDragEnd={finishFormulaDrag}
            >{element}</i>
          ))}
          {!elements.length && formulaDropTarget?.target === target && dragActive
            ? <span className="formula-expression-drop-marker formula-expression-drop-marker-empty" aria-hidden="true" />
            : null}
        </div>
        <div
          className={`formula-expression-delete ${draggedExpressionIndex === null || activeFormulaEditor !== target ? "" : "active"}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const expressionIndex = draggedExpressionIndexRef.current ?? draggedExpressionIndex;
            const expressionTarget = draggedExpressionTargetRef.current ?? activeFormulaEditor;
            if (expressionTarget === target && expressionIndex !== null) removeFormulaElement(target, expressionIndex);
            finishFormulaDrag();
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
    const nextSteps = placeFormulaStep(formulaDraft.steps, nextStep, editingStepIndex);
    const normalizedSteps = nextSteps.some((step) => step.result)
      ? nextSteps
      : nextSteps.map((step, index) => ({ ...step, result: index === nextSteps.length - 1 }));
    const nextDraft = { ...formulaDraft, steps: normalizedSteps };
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
              : result.message === "formula_reference_locked"
                ? "当前责任引用了标准公式，请先解除引用关系后再修改。"
          : `公式保存失败：${result.message ?? "请检查表达式"}`);
      return false;
    }
    const next = automationFormulas.map((item) => item.benefitId === result.benefitId ? { ...draft, ...result } : item);
    setAutomationFormulas(next);
    setFormulaDraft({ ...draft, ...result });
    setFormulaMessage(successMessage);
    return true;
  }

  async function saveAsStandardFormula() {
    if (!selectedPolicy || !formulaDraft || configTarget?.scope !== "benefit") return;
    if (!formulaDraft.matchExpression.trim() || !formulaDraft.steps.length) {
      setFormulaMessage("请先配置完整公式，再保存为标准公式。");
      return;
    }
    const saved = await saveFormula(formulaDraft, "公式已保存，正在生成标准公式编号。");
    if (!saved) return;
    setBusy(true);
    const response = await apiFetch("/api/automatic-calculation/formulas/standards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyId: selectedPolicy.id, benefitId: configTarget.target.id }),
    });
    const result = await response.json() as StandardFormulaView & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setFormulaMessage(`保存标准公式失败：${result.message ?? "请稍后重试"}`);
      return;
    }
    setStandardFormulas((items) => [result, ...items]);
    setFormulaMessage(`已保存为标准公式 ${result.formulaCode}，其他责任现在可以直接引用。`);
  }

  async function referenceSelectedFormula() {
    if (!selectedPolicy || !formulaDraft || configTarget?.scope !== "benefit" || !selectedStandardFormulaId) return;
    if (formulaDraft.steps.length && !globalThis.confirm("引用标准公式将覆盖当前责任已有的公式内容，是否继续？")) return;
    setBusy(true);
    setFormulaMessage("");
    const response = await apiFetch("/api/automatic-calculation/formulas/reference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyId: selectedPolicy.id,
        benefitId: configTarget.target.id,
        standardFormulaId: Number(selectedStandardFormulaId),
      }),
    });
    const result = await response.json() as BenefitFormulaView & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setFormulaMessage(`引用标准公式失败：${result.message ?? "请稍后重试"}`);
      return;
    }
    const merged = { ...formulaDraft, ...result };
    setAutomationFormulas((items) => items.map((item) => item.benefitId === merged.benefitId ? { ...item, ...merged } : item));
    setFormulaDraft(merged);
    setSelectedStandardFormulaId("");
    setFormulaMessage(`已引用标准公式 ${result.standardFormulaCode}，解除引用前不可修改。`);
  }

  async function unlinkReferencedFormula() {
    if (!selectedPolicy || !formulaDraft || configTarget?.scope !== "benefit" || !formulaDraft.standardFormulaId) return;
    if (!globalThis.confirm(`解除与标准公式 ${formulaDraft.standardFormulaCode ?? ""} 的引用关系后，当前公式将成为可编辑副本。是否继续？`)) return;
    setBusy(true);
    const response = await apiFetch("/api/automatic-calculation/formulas/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyId: selectedPolicy.id, benefitId: configTarget.target.id }),
    });
    const result = await response.json() as BenefitFormulaView & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setFormulaMessage(`解除引用失败：${result.message ?? "请稍后重试"}`);
      return;
    }
    const merged = { ...formulaDraft, ...result, standardFormulaId: undefined, standardFormulaCode: undefined };
    setAutomationFormulas((items) => items.map((item) => item.benefitId === merged.benefitId ? { ...item, ...merged } : item));
    setFormulaDraft(merged);
    setFormulaMessage("引用关系已解除，当前公式内容已保留并可以修改。");
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
      body: JSON.stringify({ ...customVariable, policyId: selectedPolicy.id }),
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
    if (view === "formula" && selectedPolicyId) void loadAutomation(selectedPolicyId);
    return buildParameterContext(row, itemsRef.current);
  }

  function startCreate() {
    const target = configTargetRef.current;
    if (!target) return { type: "operation_error", reason: "configuration_target_required" };
    const targetParameters = itemsRef.current.filter((item) => item.scope === target.scope && item.targetId === target.target.id);
    const firstDefinition = definitionsRef.current.find((definition) =>
      definition.applicableScopes.includes(target.scope)
      && isNewConfigurationParameterName(definition.parameterName)
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
    if (!response.ok) {
      setBusy(false);
      setMessage(result.message === "parameter_code_exists" ? "当前对象下已存在相同参数编码。" : "保存失败，请检查输入。");
      return { type: "operation_error", reason: result.message ?? "save_failed" };
    }
    const nextItems = currentEditor.id
      ? itemsRef.current.map((item) => item.id === result.id ? result : item)
      : [...itemsRef.current, result];
    itemsRef.current = nextItems;
    setItems(nextItems);
    if (selectedPolicyId) await loadAutomation(selectedPolicyId);
    setBusy(false);
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
    if (!response.ok) {
      setBusy(false);
      setMessage("删除失败，请稍后重试。");
      return { type: "operation_error", reason: "delete_failed" };
    }
    const nextItems = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = nextItems;
    setItems(nextItems);
    if (selectedPolicyId) await loadAutomation(selectedPolicyId);
    setBusy(false);
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
      .filter((definition) => Boolean(currentEditor.id) || isNewConfigurationParameterName(definition.parameterName))
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
    getRuntimeCapabilities() {
      if (pendingDeleteIdRef.current) {
        return {
          availableActionIds: ["confirm_delete_parameter", "cancel_delete_parameter"],
          availableFieldIds: [],
        };
      }
      if (!selectedPolicyIdRef.current) {
        return {
          availableActionIds: ["search", "reset"],
          availableFieldIds: ["policyNo"],
        };
      }
      if (!configTargetRef.current) {
        return {
          availableActionIds: ["search", "reset", "configure"],
          availableFieldIds: ["policyNo"],
        };
      }
      if (editorOpenRef.current) {
        return {
          availableActionIds: ["save_parameter", "cancel_edit"],
          availableFieldIds: ["definitionCode", "parameterValue", "description", "enabled"],
        };
      }
      return {
        availableActionIds: ["create_parameter", "back_to_objects", "edit_parameter", "request_delete_parameter"],
        availableFieldIds: [],
      };
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
            {configurationView === "formula" ? <button type="button" onClick={openFormulaValidation} disabled={busy}>公式验算</button> : null}
            {configurationView === "formula" && !formulaLocked ? <button type="button" onClick={() => void saveAsStandardFormula()} disabled={busy || !formulaDraft?.steps.length}>保存为标准公式</button> : null}
            {configurationView === "formula" && formulaLocked ? <button type="button" onClick={() => void unlinkReferencedFormula()} disabled={busy}>解除引用关系</button> : null}
            {configurationView === "formula" && !formulaLocked ? <button type="button" className="danger-button" onClick={() => void deleteFormulaConfiguration()} disabled={busy}>删除公式</button> : null}
            <button type="button" className="page-back-button" onClick={() => { updateConfigTarget(null); updateEditorOpen(false); setConfigurationView("parameter"); setMessage(""); }}>返回上一页</button>
          </div>
        </section>

        {configurationView === "formula" && configTarget.scope === "benefit" && formulaDraft ? (
          <section className={`panel formula-reference-panel ${formulaLocked ? "locked" : ""}`}>
            {formulaLocked ? (
              <div className="formula-reference-status">
                <span>当前责任引用标准公式</span>
                <strong>{formulaDraft.standardFormulaCode}</strong>
                <small>公式内容已锁定；如需调整，请先解除引用关系。</small>
              </div>
            ) : (
              <div className="formula-reference-picker">
                <div><strong>引用标准公式</strong><small>选择后将整套公式应用到当前责任，并锁定修改。</small></div>
                <select value={selectedStandardFormulaId} onChange={(event) => setSelectedStandardFormulaId(event.target.value)} disabled={busy || !standardFormulas.length}>
                  <option value="">{standardFormulas.length ? "请选择标准公式" : "暂无标准公式"}</option>
                  {standardFormulas.map((formula) => <option key={formula.id} value={formula.id}>{formula.formulaCode}｜{formula.formulaName}</option>)}
                </select>
                <button type="button" onClick={() => void referenceSelectedFormula()} disabled={busy || !selectedStandardFormulaId}>引用标准公式</button>
              </div>
            )}
          </section>
        ) : null}

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
            <fieldset className="formula-reference-lock" disabled={formulaLocked}>
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
                  const categoryVariables = formulaLibraryVariables.filter((item) => item.category === category && (category !== "benefit" || item.benefitId === configTarget.target.id));
                  if (!categoryVariables.length) return null;
                  return (
                    <div key={category}>
                      <strong>{variableCategoryLabels[category]}</strong>
                      <CustomDropdown value="" options={categoryVariables.map((variable) => ({
                        value: variable.formulaName ?? variable.variableName,
                        label: formulaVariableOptionLabel(variable),
                      }))} onChange={(value) => {
                        const variable = categoryVariables.find((item) => (item.formulaName ?? item.variableName) === value);
                        if (variable) selectFormulaVariable(variable);
                      }} />
                    </div>
                  );
                })}
                {activeFormulaEditor === "step" && formulaDraft.steps.length ? (
                  <div>
                    <strong>已添加步骤</strong>
                    <CustomDropdown
                      value=""
                      options={formulaDraft.steps.slice(0, editingStepIndex ?? formulaDraft.steps.length).map((step) => ({ value: step.name, label: step.name }))}
                      onChange={(value) => { if (value) appendFormulaToken(value); }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="formula-library-tools">
                <div className="formula-library-tools-heading">
                  <div><strong>符号、逻辑与常数</strong><small>当前加入到：<b>{activeFormulaEditor === "match" ? "第一步 · 自动匹配条件" : editingStepIndex === null ? "新增公式步骤" : `第 ${editingStepIndex + 2} 步`}</b></small></div>
                  <span>可点击加入，也可直接拖入下方表达式的指定位置</span>
                </div>
                <div className="formula-library-tools-content">
                  <div className="formula-tool-group">
                    <strong>符号与逻辑</strong>
                    <div>
                      {["+", "-", "*", "/", "(", ")", "并且", "或者", "=", "≠", ">", "<", "≥", "≤"].map((operator) => (
                        <button
                          type="button"
                          key={operator}
                          draggable
                          title="点击加入，或拖入公式表达式"
                          onClick={() => appendFormulaToken(operator)}
                          onDragStart={(event) => beginLibraryElementDrag(event, formulaExpressionElements(operator, knownFormulaElementNames))}
                          onDragEnd={finishFormulaDrag}
                        >{operator}</button>
                      ))}
                      {[
                        { label: "取大（，）", tokens: ["取大", "(", ",", ")"] },
                        { label: "取小（，）", tokens: ["取小", "(", ",", ")"] },
                      ].map((item) => (
                        <button
                          type="button"
                          key={item.label}
                          draggable
                          title="点击加入，或拖入公式表达式"
                          onClick={() => appendFormulaToken(item.tokens)}
                          onDragStart={(event) => beginLibraryElementDrag(event, item.tokens)}
                          onDragEnd={finishFormulaDrag}
                        >{item.label}</button>
                      ))}
                      <button
                        type="button"
                        draggable
                        title="点击加入，或拖入公式表达式"
                        onClick={() => appendFormulaToken(["如果", "(", ")", "则", "(", ")", "否则", "(", ")"])}
                        onDragStart={(event) => beginLibraryElementDrag(event, ["如果", "(", ")", "则", "(", ")", "否则", "(", ")"])}
                        onDragEnd={finishFormulaDrag}
                      >如果（ ）则（ ）否则（ ）</button>
                    </div>
                  </div>
                  <div className="formula-tool-group formula-constant-group">
                    <strong>常数参数</strong>
                    <div>
                      <input type="number" step="any" value={manualFormulaElement} onChange={(event) => setManualFormulaElement(event.target.value)} placeholder="例如 100、0.8" />
                      <button
                        type="button"
                        draggable={/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(manualFormulaElement.trim())}
                        title="输入数字后可点击加入，或拖入公式表达式"
                        onClick={appendNumericConstant}
                        onDragStart={(event) => {
                          const value = manualFormulaElement.trim();
                          if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) beginLibraryElementDrag(event, [value]);
                        }}
                        onDragEnd={finishFormulaDrag}
                      >加入常数</button>
                    </div>
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
              {formulaMessage ? <div className={`config-message formula-editor-message ${formulaMessage.includes("已") ? "success" : ""}`}>{formulaMessage}</div> : null}
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
            </section>
            </fieldset>

            {formulaValidationOpen ? (
              <section className="panel formula-validation-panel">
                <div className="panel-title-row">
                  <div>
                    <div className="section-title">公式验算</div>
                    <small className="muted">输入本次验算所需参数，系统将按步骤执行当前公式。</small>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => { setFormulaValidationOpen(false); setFormulaValidationResult(null); setFormulaValidationMessage(""); }}>关闭</button>
                </div>

                {formulaValidationVariables.length ? (
                  <div className="formula-validation-inputs">
                    {formulaValidationVariables.map((variable) => {
                      const name = variable.formulaName ?? variable.variableName;
                      const fixedOptions = variable.options;
                      return (
                        <label key={`${variable.category}-${name}`}>
                          <span>{name}{variable.unit ? <small>（{variable.unit}）</small> : null}</span>
                          {fixedOptions ? (
                            <CustomDropdown
                              value={formulaValidationInputs[name] ?? ""}
                              options={fixedOptions.map((value) => ({ value, label: value }))}
                              onChange={(value) => updateFormulaValidationInput(name, value)}
                              placeholder="请选择"
                            />
                          ) : variable.valueType === "boolean" ? (
                            <CustomDropdown
                              value={(formulaValidationInputs[name] || "false") as "true" | "false"}
                              options={[{ value: "true", label: "是" }, { value: "false", label: "否" }]}
                              onChange={(value) => updateFormulaValidationInput(name, value)}
                            />
                          ) : (
                            <input
                              type={["number", "amount", "percentage"].includes(variable.valueType) ? "number" : "text"}
                              step="any"
                              value={formulaValidationInputs[name] ?? ""}
                              onChange={(event) => updateFormulaValidationInput(name, event.target.value)}
                              placeholder={`请输入${name}`}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : <div className="formula-validation-empty">当前公式未引用需要手工输入的参数，可直接验算。</div>}

                <div className="formula-validation-actions">
                  {formulaValidationMessage ? <span className={formulaValidationResult ? "success" : ""}>{formulaValidationMessage}</span> : null}
                  <button type="button" onClick={() => void runFormulaValidation()} disabled={busy}>{busy ? "验算中..." : "开始验算"}</button>
                </div>

                {formulaValidationResult ? (
                  <div className="formula-validation-process">
                    <div className={`formula-validation-summary ${formulaValidationResult.matched ? "matched" : "unmatched"}`}>
                      <span>自动匹配条件</span>
                      <strong>{formulaValidationResult.matched ? "符合" : "不符合"}</strong>
                      <small>{formulaValidationResult.matched ? `公式结果：${displayValidationValue(formulaValidationResult.result)}` : "未进入后续计算"}</small>
                    </div>
                    <ol>
                      <li>
                        <div className="formula-validation-step-heading"><b>第 1 步 · 自动匹配条件</b><strong>{formulaValidationResult.matched ? "符合" : "不符合"}</strong></div>
                        <dl>
                          <div><dt>原表达式</dt><dd>{formulaValidationResult.matchExpression}</dd></div>
                          <div><dt>代入参数</dt><dd>{formulaValidationResult.substitutedMatchExpression}</dd></div>
                          <div><dt>计算结果</dt><dd>{formulaValidationResult.matched ? "是（账单进入后续计算）" : "否（验算已停止，不执行后续步骤）"}</dd></div>
                        </dl>
                      </li>
                      {formulaValidationResult.steps.map((step, index) => (
                        <li key={`${step.id}-${index}`} className={step.result ? "result-step" : ""}>
                          <div className="formula-validation-step-heading">
                            <b>第 {index + 2} 步 · {step.name}</b>
                            {step.result ? <span>公式结果</span> : null}
                            <strong>{displayValidationValue(step.value)}</strong>
                          </div>
                          <dl>
                            <div><dt>原表达式</dt><dd>{step.expression}</dd></div>
                            <div><dt>代入参数</dt><dd>{step.substitutedExpression}</dd></div>
                            <div><dt>计算结果</dt><dd>{displayValidationValue(step.value)}</dd></div>
                          </dl>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </section>
            ) : null}
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
                      const configuredParameters = sortCalculationParameters(items.filter((item) => item.scope === row.scope && item.targetId === row.target.id));
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
                          <td>{configuredFormula ? <span className="formula-step-count">{configuredFormula.standardFormulaCode ? `${configuredFormula.standardFormulaCode} · ` : ""}{configuredFormula.steps.length + 1} 步</span> : <span className="muted">-</span>}</td>
                          <td className="actions-cell">
                            <button type="button" className="action-link" onClick={() => openConfiguration(row, "parameter")}>参数</button>
                            {row.scope === "benefit" ? <button type="button" className="action-link" onClick={() => openConfiguration(row, "formula")}>公式</button> : null}
                          </td>
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
