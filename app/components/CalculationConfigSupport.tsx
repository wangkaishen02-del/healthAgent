"use client";

import { useEffect, useRef, useState } from "react";
import type { AutomationValueType, CalculationVariableCategory, CalculationVariableView, FormulaStep } from "../../src/calculation/automation-types";
import type {
  CalculationConfigCatalog,
  CalculationConfigTarget,
  CalculationParameter,
  CalculationParameterScope,
  CalculationParameterValueType,
  Policy,
} from "../../src/underwriting/types";


export type Option<T extends string> = { value: T; label: string };
export type ConfigTarget = { scope: CalculationParameterScope; target: CalculationConfigTarget };
export type HierarchyRow = ConfigTarget & {
  key: string;
  level: number;
  parentName?: string;
  ancestorKeys: string[];
  hasChildren: boolean;
};
export type HierarchyPathNode = ConfigTarget;

export const scopeLabels: Record<CalculationParameterScope, string> = {
  policy: "保单",
  plan: "保障计划",
  product: "险种",
  benefit: "责任",
};

export const valueTypeOptions: Option<CalculationParameterValueType>[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数值" },
  { value: "percentage", label: "百分比" },
  { value: "amount", label: "金额" },
  { value: "boolean", label: "是/否" },
];

export const emptyCatalog: CalculationConfigCatalog = { policy: [], plan: [], product: [], benefit: [] };

export type EditorState = {
  id?: string;
  definitionCode: string;
  parameterValue: string;
  description: string;
  enabled: boolean;
};

export const emptyEditor: EditorState = {
  definitionCode: "",
  parameterValue: "",
  description: "",
  enabled: true,
};

export const variableCategoryLabels: Record<CalculationVariableCategory, string> = {
  bill: "账单参数",
  event: "事件参数",
  ledger: "台账参数",
  benefit: "配置参数",
  custom: "自定义参数",
};

export const formulaDragMime = "application/x-healthagent-formula-elements";

export function isNewConfigurationParameterName(name: string) {
  return name === "限额" || name === "免赔额" || name === "赔付比例";
}

export function formulaVariableOptionLabel(variable: CalculationVariableView) {
  const name = variable.formulaName ?? variable.variableName;
  if (variable.category !== "benefit" || variable.defaultValue === undefined || variable.defaultValue === "") {
    return name;
  }
  const numericValue = Number(variable.defaultValue);
  const value = ["number", "amount", "percentage"].includes(variable.valueType) && Number.isFinite(numericValue)
    ? numericValue.toLocaleString("zh-CN")
    : variable.valueType === "boolean"
      ? variable.defaultValue === "true" ? "是" : "否"
      : variable.defaultValue;
  return `${name} · ${value}${variable.unit ?? ""}`;
}

export const emptyCustomVariable = {
  category: "bill" as CalculationVariableCategory,
  variableName: "",
  valueType: "number" as AutomationValueType,
  timeRange: "year" as "year" | "month" | "day",
  responsibilityRange: "benefit" as "benefit" | "product" | "plan" | "event",
  defaultValue: "",
};

export function emptyFormulaStep(index: number): FormulaStep {
  return { id: String(index + 1), name: "", expression: "", result: false };
}

export function formulaExpressionElements(expression: string, knownNames: string[]) {
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

export const AGENT_LIST_CONTEXT_LIMIT = 50;

export function buildHierarchyRows(catalog: CalculationConfigCatalog, policyId: string | null): HierarchyRow[] {
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

export function buildTargetPath(catalog: CalculationConfigCatalog, selected: ConfigTarget): HierarchyPathNode[] {
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

export function buildHierarchyContext(rows: HierarchyRow[], items: CalculationParameter[]) {
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

export function buildParameterContext(target: ConfigTarget, items: CalculationParameter[]) {
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

export function CustomDropdown<T extends string>({
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

export function formatPolicyStatus(status: Policy["policyStatus"]) {
  return status === "enabled" ? "启用" : "停用";
}

export function valueTypeLabel(value: CalculationParameterValueType) {
  return valueTypeOptions.find((option) => option.value === value)?.label ?? value;
}
