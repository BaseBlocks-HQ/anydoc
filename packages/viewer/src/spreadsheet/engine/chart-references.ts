import { cellKey, parseRangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetChartDataSource,
  SpreadsheetChartReference,
  SpreadsheetScalar,
  SpreadsheetSheet,
} from "./model.ts";

const MAX_FORMULA_CHARACTERS = 32_768;
const MAX_REFERENCE_AREAS = 4_096;
const MAX_RESOLVED_POINTS = 1_000_000;

function stripOuterParentheses(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "'") {
      if (quoted && trimmed[index + 1] === "'") index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return trimmed;
    if (depth < 0) return trimmed;
  }
  return depth === 0 && !quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

function splitUnion(source: string): readonly string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      if (quoted && source[index + 1] === "'") index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) return undefined;
  }
  if (quoted || depth !== 0) return undefined;
  parts.push(source.slice(start).trim());
  return parts.every(Boolean) ? parts : undefined;
}

function referenceSeparator(source: string): number {
  let quoted = false;
  let separator = -1;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "'") {
      if (quoted && source[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && source[index] === "!") separator = index;
  }
  return quoted ? -1 : separator;
}

function sheetName(source: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed || trimmed.includes("[") || trimmed.includes("]")) return undefined;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return /^[^'!]+$/u.test(trimmed) ? trimmed : undefined;
}

export function parseChartReferenceFormula(formula: string): SpreadsheetChartReference {
  const raw = formula.trim();
  if (!raw || raw.length > MAX_FORMULA_CHARACTERS) return { formula: raw, kind: "opaque" };
  const operands = splitUnion(stripOuterParentheses(raw));
  if (!operands || operands.length > MAX_REFERENCE_AREAS) return { formula: raw, kind: "opaque" };
  try {
    const areas = operands.map((operand) => {
      const separator = referenceSeparator(operand);
      const qualifier = separator < 0 ? undefined : sheetName(operand.slice(0, separator));
      if (separator >= 0 && qualifier === undefined)
        throw new Error("Unsupported chart qualifier.");
      const address = (separator < 0 ? operand : operand.slice(separator + 1)).replaceAll("$", "");
      return {
        range: parseRangeAddress(address),
        ...(qualifier ? { sheetName: qualifier } : {}),
      };
    });
    return { areas, formula: raw, kind: "areas" };
  } catch {
    return { formula: raw, kind: "opaque" };
  }
}

function cellValue(sheet: SpreadsheetSheet, row: number, column: number): SpreadsheetScalar {
  const cell = sheet.cells.get(cellKey(row, column));
  return cell?.formula ? (cell.formulaResult ?? null) : (cell?.value ?? null);
}

export function resolveChartDataSource(
  source: SpreadsheetChartDataSource,
  currentSheet: SpreadsheetSheet,
  resolveSheet: (name: string) => SpreadsheetSheet | undefined,
): readonly SpreadsheetScalar[] {
  const reference = source.reference;
  if (reference?.kind === "areas") {
    const values: SpreadsheetScalar[] = [];
    for (const area of reference.areas) {
      const sheet = area.sheetName ? resolveSheet(area.sheetName) : currentSheet;
      if (!sheet) return source.cache;
      const count =
        (area.range.bottom - area.range.top + 1) * (area.range.right - area.range.left + 1);
      if (values.length + count > MAX_RESOLVED_POINTS) return source.cache;
      for (let row = area.range.top; row <= area.range.bottom; row += 1) {
        for (let column = area.range.left; column <= area.range.right; column += 1) {
          values.push(cellValue(sheet, row, column));
        }
      }
    }
    return values;
  }
  return source.cache;
}
