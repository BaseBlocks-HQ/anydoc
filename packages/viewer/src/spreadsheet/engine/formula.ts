import { cellAddress, cellKey, parseCellAddress } from "./coordinates.ts";
import type { SpreadsheetDiagnostic, SpreadsheetScalar } from "./model.ts";

export type FormulaEngineCell = Readonly<{
  column: number;
  formula?: string;
  row: number;
  value: SpreadsheetScalar;
}>;

export type FormulaEngineSheet = Readonly<{
  cells: ReadonlyMap<string, FormulaEngineCell>;
  id: string;
  name: string;
}>;

export type FormulaEngineInput = Readonly<{
  sheets: ReadonlyArray<FormulaEngineSheet>;
}>;

export type FormulaEngineUpdate = Readonly<{
  column: number;
  row: number;
  sheetId: string;
  value: SpreadsheetScalar;
}>;

export type FormulaEngineResult = Readonly<{
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  updates: ReadonlyArray<FormulaEngineUpdate>;
}>;

export interface FormulaEngine {
  readonly id: string;
  recalculate(input: FormulaEngineInput): FormulaEngineResult | Promise<FormulaEngineResult>;
}

export type FormulaRecalculationResult = Readonly<{
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  engineId: string;
  evaluatedCells: number;
}>;

type Token = Readonly<{ kind: "identifier" | "number" | "string" | "symbol"; value: string }>;

type ReferenceNode = Readonly<{
  column: number;
  kind: "reference";
  row: number;
  sheet?: string;
}>;

type FormulaNode =
  | Readonly<{ kind: "literal"; value: SpreadsheetScalar }>
  | ReferenceNode
  | Readonly<{ end: ReferenceNode; kind: "range"; start: ReferenceNode }>
  | Readonly<{ kind: "unary"; operator: "+" | "-"; value: FormulaNode }>
  | Readonly<{ kind: "binary"; left: FormulaNode; operator: string; right: FormulaNode }>
  | Readonly<{ arguments: readonly FormulaNode[]; kind: "call"; name: string }>;

class FormulaFailure extends Error {
  readonly code: string;
  readonly value: string;

  constructor(code: string, message: string, value: string) {
    super(message);
    this.code = code;
    this.value = value;
  }
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    const character = source[position];
    if (/\s/u.test(character)) {
      position += 1;
      continue;
    }
    if (character === '"') {
      let value = "";
      position += 1;
      let closed = false;
      while (position < source.length) {
        if (source[position] === '"') {
          if (source[position + 1] === '"') {
            value += '"';
            position += 2;
            continue;
          }
          closed = true;
          position += 1;
          break;
        }
        value += source[position];
        position += 1;
      }
      if (!closed)
        throw new FormulaFailure("formula.parse", "Unterminated string literal.", "#ERROR!");
      tokens.push({ kind: "string", value });
      continue;
    }
    if (character === "'") {
      let value = "";
      position += 1;
      let closed = false;
      while (position < source.length) {
        if (source[position] === "'") {
          if (source[position + 1] === "'") {
            value += "'";
            position += 2;
            continue;
          }
          closed = true;
          position += 1;
          break;
        }
        value += source[position];
        position += 1;
      }
      if (!closed) throw new FormulaFailure("formula.parse", "Unterminated sheet name.", "#ERROR!");
      tokens.push({ kind: "identifier", value });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/u.exec(source.slice(position));
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      position += number[0].length;
      continue;
    }
    const identifier = /^[A-Z_$][A-Z\d_.$]*/iu.exec(source.slice(position));
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      position += identifier[0].length;
      continue;
    }
    const comparison = /^(?:<=|>=|<>)/u.exec(source.slice(position));
    if (comparison) {
      tokens.push({ kind: "symbol", value: comparison[0] });
      position += comparison[0].length;
      continue;
    }
    if ("+-*/^&=<>():,!".includes(character)) {
      tokens.push({ kind: "symbol", value: character });
      position += 1;
      continue;
    }
    throw new FormulaFailure(
      "formula.parse",
      `Unexpected formula character: ${character}`,
      "#ERROR!",
    );
  }
  return tokens;
}

class FormulaParser {
  readonly #tokens: readonly Token[];
  #position = 0;

  constructor(source: string) {
    this.#tokens = tokenize(source.replace(/^=/u, ""));
  }

  parse(): FormulaNode {
    const result = this.#comparison();
    if (this.#peek())
      throw new FormulaFailure(
        "formula.parse",
        `Unexpected token: ${this.#peek()?.value}`,
        "#ERROR!",
      );
    return result;
  }

  #comparison(): FormulaNode {
    let left = this.#additive();
    while (["=", "<>", "<", ">", "<=", ">="].includes(this.#peek()?.value ?? "")) {
      const operator = this.#take().value;
      left = { kind: "binary", left, operator, right: this.#additive() };
    }
    return left;
  }

  #additive(): FormulaNode {
    let left = this.#multiplicative();
    while (["+", "-", "&"].includes(this.#peek()?.value ?? "")) {
      const operator = this.#take().value;
      left = { kind: "binary", left, operator, right: this.#multiplicative() };
    }
    return left;
  }

  #multiplicative(): FormulaNode {
    let left = this.#power();
    while (["*", "/"].includes(this.#peek()?.value ?? "")) {
      const operator = this.#take().value;
      left = { kind: "binary", left, operator, right: this.#power() };
    }
    return left;
  }

  #power(): FormulaNode {
    const left = this.#unary();
    return this.#match("^") ? { kind: "binary", left, operator: "^", right: this.#power() } : left;
  }

  #unary(): FormulaNode {
    if (this.#match("+")) return { kind: "unary", operator: "+", value: this.#unary() };
    if (this.#match("-")) return { kind: "unary", operator: "-", value: this.#unary() };
    return this.#primary();
  }

  #primary(): FormulaNode {
    const token = this.#take();
    if (token.kind === "number") return { kind: "literal", value: Number(token.value) };
    if (token.kind === "string") return { kind: "literal", value: token.value };
    if (token.value === "(") {
      const value = this.#comparison();
      this.#expect(")");
      return value;
    }
    if (token.kind !== "identifier") {
      throw new FormulaFailure("formula.parse", `Unexpected token: ${token.value}`, "#ERROR!");
    }
    if (this.#match("(")) {
      const arguments_: FormulaNode[] = [];
      if (!this.#match(")")) {
        do arguments_.push(this.#comparison());
        while (this.#match(","));
        this.#expect(")");
      }
      return { arguments: arguments_, kind: "call", name: token.value.toUpperCase() };
    }
    if (token.value.toUpperCase() === "TRUE") return { kind: "literal", value: true };
    if (token.value.toUpperCase() === "FALSE") return { kind: "literal", value: false };
    let sheet: string | undefined;
    let addressToken = token;
    if (this.#match("!")) {
      sheet = token.value;
      addressToken = this.#take();
    }
    if (addressToken.kind !== "identifier" || !/^\$?[A-Z]{1,3}\$?\d+$/iu.test(addressToken.value)) {
      throw new FormulaFailure("formula.name", `Unsupported name: ${token.value}`, "#NAME?");
    }
    const position = parseCellAddress(addressToken.value);
    const start: ReferenceNode = {
      column: position.column,
      kind: "reference",
      row: position.row,
      ...(sheet ? { sheet } : {}),
    };
    if (!this.#match(":")) return start;
    const rangeToken = this.#take();
    if (rangeToken.kind !== "identifier" || !/^\$?[A-Z]{1,3}\$?\d+$/iu.test(rangeToken.value)) {
      throw new FormulaFailure(
        "formula.parse",
        "Range endpoint must be a cell reference.",
        "#REF!",
      );
    }
    const endPosition = parseCellAddress(rangeToken.value);
    return {
      end: {
        column: endPosition.column,
        kind: "reference",
        row: endPosition.row,
        ...(sheet ? { sheet } : {}),
      },
      kind: "range",
      start,
    };
  }

  #expect(value: string): void {
    if (!this.#match(value))
      throw new FormulaFailure("formula.parse", `Expected ${value}.`, "#ERROR!");
  }

  #match(value: string): boolean {
    if (this.#peek()?.value !== value) return false;
    this.#position += 1;
    return true;
  }

  #peek(): Token | undefined {
    return this.#tokens[this.#position];
  }

  #take(): Token {
    const token = this.#tokens[this.#position];
    if (!token) throw new FormulaFailure("formula.parse", "Unexpected end of formula.", "#ERROR!");
    this.#position += 1;
    return token;
  }
}

type EvaluationValue = SpreadsheetScalar | readonly SpreadsheetScalar[];

function scalar(value: EvaluationValue): SpreadsheetScalar {
  if (Array.isArray(value))
    throw new FormulaFailure(
      "formula.value",
      "A range cannot be used as a scalar here.",
      "#VALUE!",
    );
  return value as SpreadsheetScalar;
}

function numeric(value: SpreadsheetScalar): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  if (value.trim() && Number.isFinite(parsed)) return parsed;
  throw new FormulaFailure(
    "formula.value",
    `Expected a number, received ${JSON.stringify(value)}.`,
    "#VALUE!",
  );
}

function truthy(value: SpreadsheetScalar): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.length > 0;
}

function comparable(value: SpreadsheetScalar): string | number | boolean {
  return value ?? 0;
}

export class BuiltInFormulaEngine implements FormulaEngine {
  readonly id = "anydoc-basic-v1";

  recalculate(input: FormulaEngineInput): FormulaEngineResult {
    const diagnostics: SpreadsheetDiagnostic[] = [];
    const updates: FormulaEngineUpdate[] = [];
    const sheetsById = new Map(input.sheets.map((sheet) => [sheet.id, sheet]));
    const sheetsByName = new Map(input.sheets.map((sheet) => [sheet.name.toLowerCase(), sheet]));
    const states = new Map<string, "done" | "visiting">();
    const values = new Map<string, SpreadsheetScalar>();
    const diagnosticKeys = new Set<string>();
    const keyFor = (sheetId: string, row: number, column: number) =>
      `${sheetId}!${cellKey(row, column)}`;

    const report = (
      failure: FormulaFailure,
      sheet: FormulaEngineSheet,
      cell: FormulaEngineCell,
    ) => {
      const key = `${failure.code}:${sheet.id}:${cell.row}:${cell.column}`;
      if (diagnosticKeys.has(key)) return;
      diagnosticKeys.add(key);
      diagnostics.push({
        address: cellAddress(cell.row, cell.column),
        code: failure.code,
        message: failure.message,
        severity: "error",
        sheetId: sheet.id,
      });
    };

    const resolveSheet = (
      name: string | undefined,
      current: FormulaEngineSheet,
    ): FormulaEngineSheet => {
      if (!name) return current;
      const resolved = sheetsByName.get(name.toLowerCase()) ?? sheetsById.get(name);
      if (!resolved)
        throw new FormulaFailure("formula.reference", `Worksheet not found: ${name}`, "#REF!");
      return resolved;
    };

    const evaluateCell = (
      sheet: FormulaEngineSheet,
      row: number,
      column: number,
    ): SpreadsheetScalar => {
      const key = keyFor(sheet.id, row, column);
      if (states.get(key) === "done") return values.get(key) ?? null;
      const cell = sheet.cells.get(cellKey(row, column));
      if (!cell?.formula) return cell?.value ?? null;
      if (states.get(key) === "visiting") {
        throw new FormulaFailure(
          "formula.cycle",
          `Circular reference includes ${sheet.name}!${cellAddress(row, column)}.`,
          "#CYCLE!",
        );
      }
      states.set(key, "visiting");
      let value: SpreadsheetScalar;
      try {
        const node = new FormulaParser(cell.formula).parse();
        value = scalar(evaluateNode(node, sheet));
      } catch (error) {
        const failure =
          error instanceof FormulaFailure
            ? error
            : new FormulaFailure(
                "formula.evaluate",
                error instanceof Error ? error.message : String(error),
                "#ERROR!",
              );
        report(failure, sheet, cell);
        value = failure.value;
      }
      states.set(key, "done");
      values.set(key, value);
      updates.push({ column, row, sheetId: sheet.id, value });
      return value;
    };

    const evaluateReference = (
      node: ReferenceNode,
      current: FormulaEngineSheet,
    ): SpreadsheetScalar => {
      const sheet = resolveSheet(node.sheet, current);
      return evaluateCell(sheet, node.row, node.column);
    };

    const evaluateNode = (node: FormulaNode, current: FormulaEngineSheet): EvaluationValue => {
      if (node.kind === "literal") return node.value;
      if (node.kind === "reference") return evaluateReference(node, current);
      if (node.kind === "range") {
        const startSheet = resolveSheet(node.start.sheet, current);
        const endSheet = resolveSheet(node.end.sheet, current);
        if (startSheet.id !== endSheet.id)
          throw new FormulaFailure("formula.reference", "A range cannot span worksheets.", "#REF!");
        const values_: SpreadsheetScalar[] = [];
        for (
          let row = Math.min(node.start.row, node.end.row);
          row <= Math.max(node.start.row, node.end.row);
          row += 1
        ) {
          for (
            let column = Math.min(node.start.column, node.end.column);
            column <= Math.max(node.start.column, node.end.column);
            column += 1
          ) {
            values_.push(evaluateCell(startSheet, row, column));
          }
        }
        return values_;
      }
      if (node.kind === "unary") {
        const value = numeric(scalar(evaluateNode(node.value, current)));
        return node.operator === "-" ? -value : value;
      }
      if (node.kind === "binary") {
        const left = scalar(evaluateNode(node.left, current));
        const right = scalar(evaluateNode(node.right, current));
        if (node.operator === "&") return `${left ?? ""}${right ?? ""}`;
        if (node.operator === "=") return comparable(left) === comparable(right);
        if (node.operator === "<>") return comparable(left) !== comparable(right);
        if (node.operator === "<") return comparable(left) < comparable(right);
        if (node.operator === ">") return comparable(left) > comparable(right);
        if (node.operator === "<=") return comparable(left) <= comparable(right);
        if (node.operator === ">=") return comparable(left) >= comparable(right);
        const leftNumber = numeric(left);
        const rightNumber = numeric(right);
        if (node.operator === "+") return leftNumber + rightNumber;
        if (node.operator === "-") return leftNumber - rightNumber;
        if (node.operator === "*") return leftNumber * rightNumber;
        if (node.operator === "^") return leftNumber ** rightNumber;
        if (rightNumber === 0)
          throw new FormulaFailure("formula.division-zero", "Division by zero.", "#DIV/0!");
        return leftNumber / rightNumber;
      }
      if (node.name === "IF") {
        if (node.arguments.length < 2 || node.arguments.length > 3)
          throw new FormulaFailure(
            "formula.arguments",
            "IF expects two or three arguments.",
            "#VALUE!",
          );
        const condition = truthy(scalar(evaluateNode(node.arguments[0], current)));
        return evaluateNode(
          condition ? node.arguments[1] : (node.arguments[2] ?? { kind: "literal", value: false }),
          current,
        );
      }
      const supported = new Set(["AVERAGE", "COUNT", "MAX", "MIN", "SUM"]);
      if (!supported.has(node.name))
        throw new FormulaFailure(
          "formula.unsupported-function",
          `Unsupported function: ${node.name}.`,
          "#NAME?",
        );
      const flattened = node.arguments.flatMap((argument) => {
        const value = evaluateNode(argument, current);
        return Array.isArray(value) ? value : [value as SpreadsheetScalar];
      });
      const numbers = flattened.filter((value): value is number => typeof value === "number");
      if (node.name === "COUNT") return numbers.length;
      if (node.name === "SUM") return numbers.reduce((sum, value) => sum + value, 0);
      if (numbers.length === 0) return node.name === "AVERAGE" ? "#DIV/0!" : 0;
      if (node.name === "AVERAGE")
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      if (node.name === "MIN") return Math.min(...numbers);
      return Math.max(...numbers);
    };

    for (const sheet of input.sheets) {
      for (const cell of sheet.cells.values())
        if (cell.formula) evaluateCell(sheet, cell.row, cell.column);
    }
    return { diagnostics, updates };
  }
}
