import { cellAddress, cellKey, parseRangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetChart,
  SpreadsheetChartSeries,
  SpreadsheetObjectAnchor,
  SpreadsheetScalar,
  SpreadsheetSheet,
} from "./model.ts";
import { attributes, decodeXml, escapeXml } from "./xml.ts";

function formula(source: string, tag: "cat" | "val"): string | undefined {
  const block = new RegExp(`<c:${tag}\\b[^>]*>([\\s\\S]*?)<\\/c:${tag}>`, "iu").exec(source)?.[1];
  const value = /<c:f\b[^>]*>([\s\S]*?)<\/c:f>/iu.exec(block ?? "")?.[1];
  return value === undefined ? undefined : decodeXml(value);
}

function stripSheet(range: string): string {
  return range.slice(range.lastIndexOf("!") + 1).replaceAll("$", "");
}

function formulaSheetName(range: string): string | undefined {
  const separator = range.lastIndexOf("!");
  if (separator < 0) return undefined;
  const value = range.slice(0, separator);
  return value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1).replaceAll("''", "'")
    : value;
}

export function parseChart(part: string, xml: string): SpreadsheetChart | undefined {
  const typeMatch = /<c:(barChart|lineChart|pieChart)\b/iu.exec(xml)?.[1];
  if (!typeMatch) return undefined;
  const barDirection = attributes(/<c:barDir\b([^>]*)\/>/iu.exec(xml)?.[1] ?? "").val;
  const type =
    typeMatch === "lineChart"
      ? "line"
      : typeMatch === "pieChart"
        ? "pie"
        : barDirection === "bar"
          ? "bar"
          : "column";
  const title = decodeXml(
    /<c:title\b[\s\S]*?<a:t\b[^>]*>([\s\S]*?)<\/a:t>[\s\S]*?<\/c:title>/iu.exec(xml)?.[1] ?? "",
  );
  const legendPosition = attributes(/<c:legendPos\b([^>]*)\/>/iu.exec(xml)?.[1] ?? "").val;
  const legend = {
    b: "bottom",
    l: "left",
    r: "right",
    t: "top",
  }[legendPosition ?? ""] as SpreadsheetChart["legend"] | undefined;
  const series: SpreadsheetChartSeries[] = [];
  for (const match of xml.matchAll(/<c:ser\b[^>]*>([\s\S]*?)<\/c:ser>/giu)) {
    const categoryRange = formula(match[1], "cat");
    const valueRange = formula(match[1], "val");
    if (!categoryRange || !valueRange) continue;
    const name = decodeXml(
      /<c:tx\b[\s\S]*?<c:v\b[^>]*>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:tx>/iu.exec(match[1])?.[1] ?? "",
    );
    const sourceSheetName = formulaSheetName(valueRange);
    series.push({
      categoryRange: stripSheet(categoryRange),
      ...(name ? { name } : {}),
      ...(sourceSheetName ? { sourceSheetName } : {}),
      valueRange: stripSheet(valueRange),
    });
  }
  return {
    id: part,
    legend: /<c:legend\b/iu.test(xml) ? (legend ?? "right") : "none",
    series,
    ...(title ? { title } : {}),
    type,
  };
}

function quotedSheet(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

export function chartXml(
  chart: SpreadsheetChart,
  sheetName: string,
  sourceSheetName: (series: SpreadsheetChartSeries) => string = () => sheetName,
): string {
  const tag = chart.type === "line" ? "lineChart" : chart.type === "pie" ? "pieChart" : "barChart";
  const series = chart.series
    .map(
      (item, index) =>
        `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${item.name ? `<c:tx><c:v>${escapeXml(item.name)}</c:v></c:tx>` : ""}<c:cat><c:strRef><c:f>${escapeXml(`${quotedSheet(sourceSheetName(item))}!${item.categoryRange}`)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(`${quotedSheet(sourceSheetName(item))}!${item.valueRange}`)}</c:f></c:numRef></c:val></c:ser>`,
    )
    .join("");
  const chartBody =
    tag === "barChart"
      ? `<c:barDir val="${chart.type === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/>${series}<c:axId val="48650112"/><c:axId val="48672768"/>`
      : series;
  const axes =
    tag === "pieChart"
      ? ""
      : '<c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="48672768"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="48650112"/><c:crosses val="autoZero"/></c:valAx>';
  const legendPosition = { bottom: "b", left: "l", right: "r", top: "t" }[
    chart.legend === "none" ? "right" : chart.legend
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : ""}<c:plotArea><c:layout/><c:${tag}>${chartBody}</c:${tag}>${axes}</c:plotArea>${chart.legend === "none" ? "" : `<c:legend><c:legendPos val="${legendPosition}"/><c:layout/></c:legend>`}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

function pointXml(point: {
  column: number;
  columnOffsetEmu: number;
  row: number;
  rowOffsetEmu: number;
}): string {
  return `<xdr:col>${point.column - 1}</xdr:col><xdr:colOff>${point.columnOffsetEmu}</xdr:colOff><xdr:row>${point.row - 1}</xdr:row><xdr:rowOff>${point.rowOffsetEmu}</xdr:rowOff>`;
}

export function chartAnchorXml(
  anchor: SpreadsheetObjectAnchor,
  relationshipId: string,
  objectId: number,
  name: string,
): string {
  const frame = `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${objectId}" name="${escapeXml(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationshipId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/>`;
  if (anchor.kind === "two-cell")
    return `<xdr:twoCellAnchor><xdr:from>${pointXml(anchor.from)}</xdr:from><xdr:to>${pointXml(anchor.to)}</xdr:to>${frame}</xdr:twoCellAnchor>`;
  if (anchor.kind === "one-cell")
    return `<xdr:oneCellAnchor><xdr:from>${pointXml(anchor.from)}</xdr:from><xdr:ext cx="${anchor.size.widthEmu}" cy="${anchor.size.heightEmu}"/>${frame}</xdr:oneCellAnchor>`;
  return `<xdr:absoluteAnchor><xdr:pos x="${anchor.position.xEmu}" y="${anchor.position.yEmu}"/><xdr:ext cx="${anchor.size.widthEmu}" cy="${anchor.size.heightEmu}"/>${frame}</xdr:absoluteAnchor>`;
}

function scalar(sheet: SpreadsheetSheet, address: string): SpreadsheetScalar {
  const range = parseRangeAddress(address);
  const cell = sheet.cells.get(cellKey(range.top, range.left));
  return cell?.formula ? (cell.formulaResult ?? null) : (cell?.value ?? null);
}

function values(sheet: SpreadsheetSheet, address: string): readonly SpreadsheetScalar[] {
  const range = parseRangeAddress(address);
  const result: SpreadsheetScalar[] = [];
  for (let row = range.top; row <= range.bottom; row += 1)
    for (let column = range.left; column <= range.right; column += 1)
      result.push(scalar(sheet, cellAddress(row, column)));
  return result;
}

export type SpreadsheetRenderedChart = Readonly<{
  chartId: string;
  categories: readonly string[];
  series: ReadonlyArray<Readonly<{ name: string; values: readonly number[] }>>;
  title?: string;
  type: SpreadsheetChart["type"];
}>;

export function renderChartModel(
  chart: SpreadsheetChart,
  sheet: SpreadsheetSheet,
  resolveSourceSheet: (series: SpreadsheetChartSeries) => SpreadsheetSheet = () => sheet,
): SpreadsheetRenderedChart {
  const first = chart.series[0];
  const firstSheet = first ? resolveSourceSheet(first) : sheet;
  const categories = first
    ? values(firstSheet, first.categoryRange).map((value) => (value === null ? "" : String(value)))
    : [];
  return {
    chartId: chart.id,
    categories,
    series: chart.series.map((item, index) => ({
      name: item.name ?? `Series ${index + 1}`,
      values: values(resolveSourceSheet(item), item.valueRange).map((value) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0,
      ),
    })),
    ...(chart.title ? { title: chart.title } : {}),
    type: chart.type,
  };
}
