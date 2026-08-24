import { parseRangeAddress, rangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetConditionalFormat,
  SpreadsheetDataValidation,
  SpreadsheetRange,
  SpreadsheetTable,
} from "./model.ts";
import type { SpreadsheetStyleStore } from "./styles.ts";
import { attributes, decodeXml, escapeXml, replaceOrInsertElement } from "./xml.ts";

function formulaScalar(value: string | undefined): string | number | boolean | null {
  if (value === undefined) return null;
  const decoded = decodeXml(value);
  if (/^(true|false)$/iu.test(decoded)) return decoded.toLowerCase() === "true";
  const number = Number(decoded);
  return Number.isFinite(number) ? number : decoded;
}

export function parseConditionalFormats(
  xml: string,
  styles: SpreadsheetStyleStore,
): readonly SpreadsheetConditionalFormat[] {
  const rules: SpreadsheetConditionalFormat[] = [];
  for (const block of xml.matchAll(
    /<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/giu,
  )) {
    const rangeText = attributes(block[1]).sqref?.split(/\s+/u)[0];
    if (!rangeText) continue;
    const range = parseRangeAddress(rangeText);
    for (const match of block[2].matchAll(/<cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/giu)) {
      const attrs = attributes(match[1]);
      const id = `cf-${rules.length + 1}`;
      const style = styles.resolveDifferential(Number(attrs.dxfId));
      if (attrs.type === "duplicateValues" || attrs.type === "uniqueValues") {
        rules.push({
          id,
          kind: attrs.type === "duplicateValues" ? "duplicate-values" : "unique-values",
          range,
          style,
        });
      } else if (attrs.type === "cellIs") {
        const operator = (
          {
            equal: "equal",
            greaterThan: "greater-than",
            greaterThanOrEqual: "greater-than-or-equal",
            lessThan: "less-than",
            lessThanOrEqual: "less-than-or-equal",
            notEqual: "not-equal",
          } as const
        )[
          attrs.operator as
            | "equal"
            | "greaterThan"
            | "greaterThanOrEqual"
            | "lessThan"
            | "lessThanOrEqual"
            | "notEqual"
        ];
        if (!operator) continue;
        rules.push({
          formula: formulaScalar(
            /<formula\b[^>]*>([\s\S]*?)<\/formula>/iu.exec(match[2] ?? "")?.[1],
          ),
          id,
          kind: "cell-is",
          operator,
          range,
          style,
        });
      }
    }
  }
  return rules;
}

export function serializeConditionalFormats(
  rules: readonly SpreadsheetConditionalFormat[],
  styles: SpreadsheetStyleStore,
): string {
  return rules
    .map((rule, index) => {
      const dxfId = styles.registerDifferential(rule.style);
      if (rule.kind !== "cell-is") {
        const type = rule.kind === "duplicate-values" ? "duplicateValues" : "uniqueValues";
        return `<conditionalFormatting sqref="${rangeAddress(rule.range)}"><cfRule type="${type}" dxfId="${dxfId}" priority="${index + 1}"/></conditionalFormatting>`;
      }
      const operator = {
        equal: "equal",
        "greater-than": "greaterThan",
        "greater-than-or-equal": "greaterThanOrEqual",
        "less-than": "lessThan",
        "less-than-or-equal": "lessThanOrEqual",
        "not-equal": "notEqual",
      }[rule.operator];
      return `<conditionalFormatting sqref="${rangeAddress(rule.range)}"><cfRule type="cellIs" dxfId="${dxfId}" priority="${index + 1}" operator="${operator}"><formula>${escapeXml(String(rule.formula ?? ""))}</formula></cfRule></conditionalFormatting>`;
    })
    .join("");
}

export function parseDataValidations(xml: string): readonly SpreadsheetDataValidation[] {
  return [...xml.matchAll(/<dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/giu)]
    .map((match, index): SpreadsheetDataValidation | null => {
      const attrs = attributes(match[1]);
      const rangeText = attrs.sqref?.split(/\s+/u)[0];
      if (attrs.type !== "list" || !rangeText) return null;
      const formula = decodeXml(
        /<formula1\b[^>]*>([\s\S]*?)<\/formula1>/iu.exec(match[2] ?? "")?.[1] ?? "",
      );
      const quoted = /^"(.*)"$/u.exec(formula);
      return {
        allowBlank: attrs.allowBlank === "1",
        ...(attrs.error ? { error: decodeXml(attrs.error) } : {}),
        ...(attrs.errorTitle ? { errorTitle: decodeXml(attrs.errorTitle) } : {}),
        id: `validation-${index + 1}`,
        ...(attrs.prompt ? { prompt: decodeXml(attrs.prompt) } : {}),
        ...(attrs.promptTitle ? { promptTitle: decodeXml(attrs.promptTitle) } : {}),
        range: parseRangeAddress(rangeText),
        source: quoted
          ? { kind: "values", values: quoted[1].split(",").map(decodeXml) }
          : { formula, kind: "range" },
      };
    })
    .filter((rule): rule is SpreadsheetDataValidation => rule !== null);
}

export function serializeDataValidations(rules: readonly SpreadsheetDataValidation[]): string {
  if (rules.length === 0) return "";
  return `<dataValidations count="${rules.length}">${rules
    .map((rule) => {
      const formula =
        rule.source.kind === "values"
          ? `"${rule.source.values.map((value) => value.replaceAll(",", "\\,")).join(",")}"`
          : rule.source.formula;
      return `<dataValidation type="list" allowBlank="${rule.allowBlank ? 1 : 0}" showInputMessage="${rule.prompt ? 1 : 0}" showErrorMessage="${rule.error ? 1 : 0}" sqref="${rangeAddress(rule.range)}"${rule.prompt ? ` prompt="${escapeXml(rule.prompt)}"` : ""}${rule.promptTitle ? ` promptTitle="${escapeXml(rule.promptTitle)}"` : ""}${rule.error ? ` error="${escapeXml(rule.error)}"` : ""}${rule.errorTitle ? ` errorTitle="${escapeXml(rule.errorTitle)}"` : ""}><formula1>${escapeXml(formula)}</formula1></dataValidation>`;
    })
    .join("")}</dataValidations>`;
}

export function replaceWorksheetFeatures(input: {
  conditionalFormatsXml: string;
  dataValidations: readonly SpreadsheetDataValidation[];
  pivotRelationshipIds: readonly string[];
  tableRelationshipIds: readonly string[];
  xml: string;
}): string {
  let xml = input.xml.replace(
    /<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>/giu,
    "",
  );
  xml = replaceOrInsertElement(xml, "conditionalFormatting", input.conditionalFormatsXml, [
    "dataValidations",
    "hyperlinks",
    "printOptions",
  ]);
  xml = replaceOrInsertElement(
    xml,
    "dataValidations",
    serializeDataValidations(input.dataValidations),
    ["hyperlinks", "printOptions", "pageMargins"],
  );
  const tableParts = input.tableRelationshipIds.length
    ? `<tableParts count="${input.tableRelationshipIds.length}">${input.tableRelationshipIds.map((id) => `<tablePart r:id="${escapeXml(id)}"/>`).join("")}</tableParts>`
    : "";
  xml = replaceOrInsertElement(xml, "tableParts", tableParts, ["extLst"]);
  const pivotParts = input.pivotRelationshipIds.length
    ? `<pivotTableParts count="${input.pivotRelationshipIds.length}">${input.pivotRelationshipIds.map((id) => `<pivotTablePart r:id="${escapeXml(id)}"/>`).join("")}</pivotTableParts>`
    : "";
  return replaceOrInsertElement(xml, "pivotTableParts", pivotParts, ["extLst"]);
}

export function tableXml(table: SpreadsheetTable): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${escapeXml(table.id)}" name="${escapeXml(table.name)}" displayName="${escapeXml(table.name)}" ref="${rangeAddress(table.range)}" totalsRowShown="0"><autoFilter ref="${rangeAddress(table.range)}"/><tableColumns count="${table.columns.length}">${table.columns.map((name, index) => `<tableColumn id="${index + 1}" name="${escapeXml(name)}"/>`).join("")}</tableColumns><tableStyleInfo name="${escapeXml(table.style)}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

export function parseTable(part: string, xml: string): SpreadsheetTable | undefined {
  const root = attributes(/<table\b([^>]*)>/iu.exec(xml)?.[1] ?? "");
  if (!root.ref || !root.name) return undefined;
  const columns = [...xml.matchAll(/<tableColumn\b([^>]*)\/?\s*>/giu)]
    .map((match) => attributes(match[1]).name)
    .filter((name): name is string => Boolean(name))
    .map(decodeXml);
  return {
    columns,
    id: root.id ?? part.match(/(\d+)\.xml$/u)?.[1] ?? part,
    name: decodeXml(root.name),
    range: parseRangeAddress(root.ref),
    showFilterButtons: /<autoFilter\b/iu.test(xml),
    style:
      attributes(/<tableStyleInfo\b([^>]*)\/?\s*>/iu.exec(xml)?.[1] ?? "").name ??
      "TableStyleMedium2",
  };
}

export function rangeContains(range: SpreadsheetRange, row: number, column: number): boolean {
  return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
}
