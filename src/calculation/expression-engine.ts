export type FormulaValue = number | string | boolean;

type Token = { type: "number" | "string" | "identifier" | "operator" | "paren" | "comma" | "eof"; value: string };

function tokenize(expression: string, variableNames: string[]) {
  const tokens: Token[] = [];
  const names = [...variableNames].sort((left, right) => right.length - left.length);
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const space = rest.match(/^\s+/);
    if (space) { index += space[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push({ type: "number", value: number[0] }); index += number[0].length; continue; }
    const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    if (quoted) { tokens.push({ type: "string", value: quoted[0].slice(1, -1) }); index += quoted[0].length; continue; }
    const chineseOperator = rest.match(/^(大于等于|小于等于|不等于|并且|或者|等于|大于|小于|非)/);
    if (chineseOperator) {
      const operatorMap: Record<string, string> = { 大于等于: ">=", 小于等于: "<=", 不等于: "!=", 并且: "&&", 或者: "||", 等于: "==", 大于: ">", 小于: "<", 非: "!" };
      tokens.push({ type: "operator", value: operatorMap[chineseOperator[0]] });
      index += chineseOperator[0].length;
      continue;
    }
    const variableName = names.find((name) => rest.startsWith(name));
    if (variableName) {
      tokens.push({ type: "identifier", value: variableName });
      index += variableName.length;
      continue;
    }
    const identifier = rest.match(/^[\p{L}_][\p{L}\p{N}_.]*/u);
    if (identifier) { tokens.push({ type: "identifier", value: identifier[0] }); index += identifier[0].length; continue; }
    const operator = rest.match(/^(\&\&|\|\||>=|<=|==|!=|≥|≤|≠|[=+\-*/><!])/);
    if (operator) {
      const operatorMap: Record<string, string> = { "=": "==", "≥": ">=", "≤": "<=", "≠": "!=" };
      tokens.push({ type: "operator", value: operatorMap[operator[0]] ?? operator[0] });
      index += operator[0].length;
      continue;
    }
    if (["(", ")", "（", "）"].includes(rest[0])) {
      tokens.push({ type: "paren", value: rest[0] === "（" ? "(" : rest[0] === "）" ? ")" : rest[0] });
      index += 1;
      continue;
    }
    if (rest[0] === "," || rest[0] === "，") { tokens.push({ type: "comma", value: "," }); index += 1; continue; }
    throw new Error(`invalid_expression_character:${rest[0]}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

export function calculationExpressionReferencesAny(expression: string, candidateNames: string[]) {
  if (!candidateNames.length) return false;
  const candidates = new Set(candidateNames);
  return tokenize(expression, candidateNames).some((token) => token.type === "identifier" && candidates.has(token.value));
}

export function calculationExpressionIdentifiers(expression: string, candidateNames: string[]) {
  const candidates = new Set(candidateNames);
  return [...new Set(
    tokenize(expression, candidateNames)
      .filter((token) => token.type === "identifier" && candidates.has(token.value))
      .map((token) => token.value),
  )];
}

function displayFormulaValue(value: FormulaValue) {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return `“${value}”`;
  return String(value);
}

export function substituteCalculationExpression(expression: string, variables: Record<string, FormulaValue>) {
  const names = Object.keys(variables).sort((left, right) => right.length - left.length);
  let result = "";
  let index = 0;
  while (index < expression.length) {
    const variableName = names.find((name) => expression.startsWith(name, index));
    if (variableName) {
      result += displayFormulaValue(variables[variableName]);
      index += variableName.length;
      continue;
    }
    result += expression[index];
    index += 1;
  }
  return result;
}

function numeric(value: FormulaValue) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: FormulaValue) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "" && value !== "false";
}

function equalValues(left: FormulaValue, right: FormulaValue) {
  if (typeof left === typeof right) return left === right;
  const leftNumber = typeof left === "string" && left.trim() !== "" ? Number(left) : typeof left === "number" ? left : NaN;
  const rightNumber = typeof right === "string" && right.trim() !== "" ? Number(right) : typeof right === "number" ? right : NaN;
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

export function evaluateCalculationExpression(expression: string, variables: Record<string, FormulaValue>) {
  const tokens = tokenize(expression, Object.keys(variables));
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const matchOperator = (operator: string) => {
    if (peek().type === "operator" && peek().value === operator) { take(); return true; }
    return false;
  };

  function primary(): FormulaValue {
    const token = take();
    if (token.type === "number") return Number(token.value);
    if (token.type === "string") return token.value;
    if (token.type === "paren" && token.value === "(") {
      const value = or();
      const closing = take();
      if (closing.type !== "paren" || closing.value !== ")") throw new Error("missing_closing_parenthesis");
      return value;
    }
    if (token.type === "identifier") {
      const upper = token.value.toUpperCase();
      if (token.value === "如果" && peek().type === "paren" && peek().value === "(") {
        take();
        const condition = or();
        if (peek().type === "comma") {
          take();
          const thenValue = or();
          const separator = take();
          if (separator.type !== "comma") throw new Error("missing_if_else_separator");
          const elseValue = or();
          const closing = take();
          if (closing.type !== "paren" || closing.value !== ")") throw new Error("missing_function_parenthesis");
          return truthy(condition) ? thenValue : elseValue;
        }
        const conditionClosing = take();
        if (conditionClosing.type !== "paren" || conditionClosing.value !== ")") throw new Error("missing_if_condition_parenthesis");
        const thenToken = take();
        if (thenToken.type !== "identifier" || thenToken.value !== "则") throw new Error("missing_if_then");
        const thenOpening = take();
        if (thenOpening.type !== "paren" || thenOpening.value !== "(") throw new Error("missing_if_then_parenthesis");
        const thenValue = or();
        const thenClosing = take();
        if (thenClosing.type !== "paren" || thenClosing.value !== ")") throw new Error("missing_if_then_parenthesis");
        const elseToken = take();
        if (elseToken.type !== "identifier" || elseToken.value !== "否则") throw new Error("missing_if_else");
        const elseOpening = take();
        if (elseOpening.type !== "paren" || elseOpening.value !== "(") throw new Error("missing_if_else_parenthesis");
        const elseValue = or();
        const elseClosing = take();
        if (elseClosing.type !== "paren" || elseClosing.value !== ")") throw new Error("missing_if_else_parenthesis");
        return truthy(condition) ? thenValue : elseValue;
      }
      if (peek().type === "paren" && peek().value === "(") {
        take();
        const args: FormulaValue[] = [];
        if (!(peek().type === "paren" && peek().value === ")")) {
          do { args.push(or()); } while (peek().type === "comma" && Boolean(take()));
        }
        const closing = take();
        if (closing.type !== "paren" || closing.value !== ")") throw new Error("missing_function_parenthesis");
        if (upper === "MIN" || token.value === "最小" || token.value === "取小") return Math.min(...args.map(numeric));
        if (upper === "MAX" || token.value === "最大" || token.value === "取大") return Math.max(...args.map(numeric));
        if (upper === "ABS" || token.value === "绝对值") return Math.abs(numeric(args[0] ?? 0));
        if (upper === "ROUND" || token.value === "四舍五入") return Number(numeric(args[0] ?? 0).toFixed(Math.max(0, numeric(args[1] ?? 2))));
        if (upper === "IF" || token.value === "如果") return truthy(args[0] ?? false) ? args[1] ?? 0 : args[2] ?? 0;
        throw new Error(`unknown_function:${token.value}`);
      }
      if (upper === "TRUE" || token.value === "是") return true;
      if (upper === "FALSE" || token.value === "否") return false;
      return variables[token.value] ?? 0;
    }
    throw new Error(`unexpected_token:${token.value}`);
  }

  function unary(): FormulaValue {
    if (matchOperator("-")) return -numeric(unary());
    if (matchOperator("+")) return numeric(unary());
    if (matchOperator("!")) return !truthy(unary());
    return primary();
  }
  function multiply(): FormulaValue {
    let value = unary();
    while (peek().type === "operator" && ["*", "/"].includes(peek().value)) {
      const operator = take().value;
      const right = numeric(unary());
      value = operator === "*" ? numeric(value) * right : right === 0 ? 0 : numeric(value) / right;
    }
    return value;
  }
  function add(): FormulaValue {
    let value = multiply();
    while (peek().type === "operator" && ["+", "-"].includes(peek().value)) {
      const operator = take().value;
      const right = multiply();
      value = operator === "+" ? numeric(value) + numeric(right) : numeric(value) - numeric(right);
    }
    return value;
  }
  function compare(): FormulaValue {
    let value = add();
    while (peek().type === "operator" && [">", "<", ">=", "<="].includes(peek().value)) {
      const operator = take().value;
      const right = add();
      if (operator === ">") value = numeric(value) > numeric(right);
      else if (operator === "<") value = numeric(value) < numeric(right);
      else if (operator === ">=") value = numeric(value) >= numeric(right);
      else value = numeric(value) <= numeric(right);
    }
    return value;
  }
  function equality(): FormulaValue {
    let value = compare();
    while (peek().type === "operator" && ["==", "!="].includes(peek().value)) {
      const operator = take().value;
      const right = compare();
      value = operator === "==" ? equalValues(value, right) : !equalValues(value, right);
    }
    return value;
  }
  function and(): FormulaValue {
    let value = equality();
    while (matchOperator("&&")) {
      const right = equality();
      value = truthy(value) && truthy(right);
    }
    return value;
  }
  function or(): FormulaValue {
    let value = and();
    while (matchOperator("||")) {
      const right = and();
      value = truthy(value) || truthy(right);
    }
    return value;
  }

  const result = or();
  if (peek().type !== "eof") throw new Error(`unexpected_token:${peek().value}`);
  return result;
}
