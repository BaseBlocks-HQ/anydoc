import type { SpreadsheetCellStyle, SpreadsheetDateSystem, SpreadsheetScalar } from "./model.ts";

const DAY_MILLISECONDS = 86_400_000;
const MAXIMUM_DATE_SERIAL = 2_958_465;

function rawValue(value: SpreadsheetScalar): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function activeFormatSection(format: string, value: number): string {
  const sections = format.split(";");
  if (value > 0) return sections[0] ?? format;
  if (value < 0) return sections[1] ?? sections[0] ?? format;
  return sections[2] ?? sections[0] ?? format;
}

function stripFormatDirectives(format: string): string {
  return format
    .replace(/"([^"]|"")*"/gu, (match) => match.slice(1, -1).replaceAll('""', '"'))
    .replace(/\[[^\]]+\]/gu, "")
    .replace(/_.|\\(.)|\*(.)/gu, "$1$2");
}

function looksLikeDateFormat(format: string): boolean {
  const normalized = stripFormatDirectives(format)
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase();
  return /[dy]/u.test(normalized) && /[mdy]/u.test(normalized);
}

function excelDate(value: number, dateSystem: SpreadsheetDateSystem): Date | null {
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_DATE_SERIAL) return null;
  const epoch = dateSystem === "1904" ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const adjusted = dateSystem === "1900" && value < 60 ? value + 1 : value;
  return new Date(epoch + adjusted * DAY_MILLISECONDS);
}

function dateDisplay(
  value: number,
  format: string,
  dateSystem: SpreadsheetDateSystem,
): string | null {
  const date = excelDate(value, dateSystem);
  if (!date) return null;
  const lower = format.toLowerCase();
  const includeTime = /[hs]/u.test(stripFormatDirectives(lower));
  const includeSeconds = /s/u.test(stripFormatDirectives(lower));
  const longMonth = /mmmm/u.test(lower);
  const shortMonth = !longMonth && /mmm/u.test(lower);
  const options: Intl.DateTimeFormatOptions = {
    day: /d/u.test(lower) ? (/dd/u.test(lower) ? "2-digit" : "numeric") : undefined,
    month: /m/u.test(lower)
      ? longMonth
        ? "long"
        : shortMonth
          ? "short"
          : /mm/u.test(lower)
            ? "2-digit"
            : "numeric"
      : undefined,
    timeZone: "UTC",
    year: /y/u.test(lower) ? (/yyyy/u.test(lower) ? "numeric" : "2-digit") : undefined,
    ...(includeTime
      ? {
          hour: "2-digit",
          hour12: /am\/pm/u.test(lower),
          minute: "2-digit",
          ...(includeSeconds ? { second: "2-digit" as const } : {}),
        }
      : {}),
  };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function decimalPlaces(format: string): number {
  const match = /\.(0+|#+)/u.exec(format);
  return match?.[1]?.length ?? 0;
}

function numberDisplay(value: number, format: string): string {
  const section = activeFormatSection(format, value);
  const normalized = stripFormatDirectives(section);
  const percent = normalized.includes("%");
  const scaled = percent ? value * 100 : value;
  const decimals = decimalPlaces(normalized);
  const useGrouping = normalized.includes(",");
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
    useGrouping,
  }).format(Math.abs(scaled));
  const literalPrefix = normalized.replace(/[0#?.,%@()\-+\s]/gu, "").replace(/[dmyhs]/giu, "");
  const negative = value < 0;
  const accounting = negative && (section.includes("(") || format.split(";")[1]?.includes("("));
  return `${literalPrefix}${accounting ? `(${formatted})` : `${negative ? "-" : ""}${formatted}`}${
    percent ? "%" : ""
  }`;
}

export function formatSpreadsheetValue(
  value: SpreadsheetScalar,
  style: SpreadsheetCellStyle,
  dateSystem: SpreadsheetDateSystem,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return rawValue(value);
  const format = style.numberFormat?.trim() ?? "General";
  if (!format || format.toLowerCase() === "general") return String(value);
  if (looksLikeDateFormat(format)) {
    const displayed = dateDisplay(value, format, dateSystem);
    if (displayed !== null) return displayed;
  }
  return numberDisplay(value, format);
}

export function spreadsheetCellDisplayValue(
  cell: Readonly<{
    formula?: string;
    formulaResult?: SpreadsheetScalar;
    style: SpreadsheetCellStyle;
    value: SpreadsheetScalar;
  }>,
  dateSystem: SpreadsheetDateSystem,
): string {
  return formatSpreadsheetValue(
    cell.formula ? (cell.formulaResult ?? null) : cell.value,
    cell.style,
    dateSystem,
  );
}
