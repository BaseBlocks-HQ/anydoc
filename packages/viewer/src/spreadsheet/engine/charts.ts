import { SaxesParser, type SaxesTagNS } from "saxes";

import { parseChartReferenceFormula, resolveChartDataSource } from "./chart-references.ts";
import { rangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetChart,
  SpreadsheetChartDataSource,
  SpreadsheetChartGroup,
  SpreadsheetChartInput,
  SpreadsheetChartSeries,
  SpreadsheetObjectAnchor,
  SpreadsheetScalar,
  SpreadsheetSheet,
} from "./model.ts";
import { escapeXml } from "./xml.ts";

const MAX_CHART_XML_NODES = 100_000;
const MAX_CHART_CACHE_POINTS = 1_000_000;

type ChartXmlNode = {
  attributes: Readonly<Record<string, string>>;
  children: ChartXmlNode[];
  name: string;
  text: string;
};

function parseChartXml(xml: string): ChartXmlNode | undefined {
  const roots: ChartXmlNode[] = [];
  const stack: ChartXmlNode[] = [];
  let nodeCount = 0;
  let failure: Error | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag: SaxesTagNS) => {
    nodeCount += 1;
    if (nodeCount > MAX_CHART_XML_NODES) {
      failure = new Error("Chart XML exceeds the node limit.");
      return;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(tag.attributes)) {
      attributes[attribute.local] = attribute.value;
      attributes[attribute.name] = attribute.value;
    }
    const node: ChartXmlNode = {
      attributes,
      children: [],
      name: tag.local,
      text: "",
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  parser.on("text", (text: string) => {
    const node = stack.at(-1);
    if (node) node.text += text;
  });
  parser.on("cdata", (text: string) => {
    const node = stack.at(-1);
    if (node) node.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", (error: Error) => {
    failure = error;
  });
  parser.write(xml).close();
  return failure ? undefined : roots[0];
}

function child(node: ChartXmlNode | undefined, name: string): ChartXmlNode | undefined {
  return node?.children.find((candidate) => candidate.name === name);
}

function children(node: ChartXmlNode | undefined, name: string): readonly ChartXmlNode[] {
  return node?.children.filter((candidate) => candidate.name === name) ?? [];
}

function descendants(node: ChartXmlNode | undefined, name: string): readonly ChartXmlNode[] {
  if (!node) return [];
  const matches: ChartXmlNode[] = [];
  const visit = (candidate: ChartXmlNode) => {
    if (candidate.name === name) matches.push(candidate);
    for (const nested of candidate.children) visit(nested);
  };
  visit(node);
  return matches;
}

function firstText(node: ChartXmlNode | undefined, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = descendants(node, name)[0]?.text.trim();
    if (value) return value;
  }
  return undefined;
}

function cachedValues(
  container: ChartXmlNode,
  valueType: SpreadsheetChartDataSource["valueType"],
): readonly SpreadsheetScalar[] {
  const cache =
    descendants(container, valueType === "number" ? "numCache" : "strCache")[0] ??
    descendants(container, "multiLvlStrCache")[0] ??
    descendants(container, valueType === "number" ? "numLit" : "strLit")[0];
  if (!cache) return [];
  const pointCount = Number(child(cache, "ptCount")?.attributes.val ?? 0);
  const points = descendants(cache, "pt")
    .map((point) => ({
      index: Number(point.attributes.idx),
      value: child(point, "v")?.text ?? "",
    }))
    .filter(({ index }) => Number.isInteger(index) && index >= 0 && index < MAX_CHART_CACHE_POINTS);
  const length = Math.min(
    MAX_CHART_CACHE_POINTS,
    Math.max(
      Number.isInteger(pointCount) ? pointCount : 0,
      ...points.map(({ index }) => index + 1),
      0,
    ),
  );
  const values: SpreadsheetScalar[] = Array.from({ length }, () => null);
  for (const point of points) {
    if (valueType === "string") values[point.index] = point.value;
    else {
      const numeric = Number(point.value);
      values[point.index] = Number.isFinite(numeric) ? numeric : null;
    }
  }
  return values;
}

function dataSource(
  series: ChartXmlNode,
  role: "cat" | "val",
): SpreadsheetChartDataSource | undefined {
  const container = child(series, role);
  if (!container) return undefined;
  const sourceKind = ["numRef", "numLit", "strRef", "strLit", "multiLvlStrRef"].find(
    (name) => descendants(container, name).length > 0,
  );
  if (!sourceKind) return undefined;
  const valueType = sourceKind.startsWith("num") ? "number" : "string";
  const formula = descendants(container, "f")[0]?.text.trim();
  return {
    cache: cachedValues(container, valueType),
    ...(formula ? { reference: parseChartReferenceFormula(formula) } : {}),
    valueType,
  };
}

function chartType(group: ChartXmlNode): SpreadsheetChartGroup["type"] | undefined {
  if (group.name === "lineChart") return "line";
  if (group.name === "pieChart") return "pie";
  if (group.name === "barChart") {
    return child(group, "barDir")?.attributes.val === "bar" ? "bar" : "column";
  }
  return undefined;
}

export function parseChart(part: string, xml: string): SpreadsheetChart | undefined {
  const root = parseChartXml(xml);
  const plotArea = descendants(root, "plotArea")[0];
  const groups: SpreadsheetChartGroup[] = [];
  for (const groupNode of plotArea?.children ?? []) {
    const type = chartType(groupNode);
    if (!type) continue;
    const series: SpreadsheetChartSeries[] = [];
    for (const seriesNode of children(groupNode, "ser")) {
      const values = dataSource(seriesNode, "val");
      if (!values) continue;
      const categories = dataSource(seriesNode, "cat");
      const name = firstText(child(seriesNode, "tx"), ["v"]);
      series.push({
        ...(categories ? { categories } : {}),
        ...(name ? { name } : {}),
        values,
      });
    }
    if (series.length > 0) groups.push({ series, type });
  }
  if (groups.length === 0) return undefined;
  const legendNode = descendants(root, "legend")[0];
  const legendPosition = descendants(legendNode, "legendPos")[0]?.attributes.val;
  const legend = legendNode
    ? (({ b: "bottom", l: "left", r: "right", t: "top" } as const)[legendPosition as "b"] ??
      "right")
    : "none";
  const titleNode = descendants(root, "title")[0];
  const title = firstText(titleNode, ["t", "v"]);
  return {
    groups,
    id: part,
    legend,
    ...(title ? { title } : {}),
  };
}

function quotedSheet(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

export function chartXml(
  chart: SpreadsheetChartInput,
  sourceSheetName: (source: SpreadsheetChartInput["series"][number]["values"]) => string,
): string {
  const tag = chart.type === "line" ? "lineChart" : chart.type === "pie" ? "pieChart" : "barChart";
  const series = chart.series
    .map((item, index) => {
      const categoryFormula = `${quotedSheet(sourceSheetName(item.categories))}!${rangeAddress(item.categories.range)}`;
      const valueFormula = `${quotedSheet(sourceSheetName(item.values))}!${rangeAddress(item.values.range)}`;
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${item.name ? `<c:tx><c:v>${escapeXml(item.name)}</c:v></c:tx>` : ""}<c:cat><c:strRef><c:f>${escapeXml(categoryFormula)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(valueFormula)}</c:f></c:numRef></c:val></c:ser>`;
    })
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

export type SpreadsheetRenderedChart = Readonly<{
  chartId: string;
  categories: readonly string[];
  legend: SpreadsheetChart["legend"];
  series: ReadonlyArray<
    Readonly<{
      name: string;
      type: SpreadsheetChartGroup["type"];
      values: readonly number[];
    }>
  >;
  title?: string;
  type: SpreadsheetChartGroup["type"];
}>;

export function renderChartModel(
  chart: SpreadsheetChart,
  sheet: SpreadsheetSheet,
  resolveSheet: (name: string) => SpreadsheetSheet | undefined = () => undefined,
): SpreadsheetRenderedChart {
  const firstGroup = chart.groups[0];
  if (!firstGroup) throw new Error("A rendered chart requires at least one chart group.");
  const first = firstGroup.series[0];
  const categories = first?.categories
    ? resolveChartDataSource(first.categories, sheet, resolveSheet).map((value) =>
        value === null ? "" : String(value),
      )
    : [];
  return {
    chartId: chart.id,
    categories,
    legend: chart.legend,
    series: chart.groups.flatMap((group) =>
      group.series.map((item, index) => ({
        name: item.name ?? `Series ${index + 1}`,
        type: group.type,
        values: resolveChartDataSource(item.values, sheet, resolveSheet).map((value) =>
          typeof value === "number" && Number.isFinite(value) ? value : 0,
        ),
      })),
    ),
    ...(chart.title ? { title: chart.title } : {}),
    type: firstGroup.type,
  };
}
