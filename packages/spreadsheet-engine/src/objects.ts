import type { OoxmlArchive } from "./archive.ts";
import { parseChart } from "./charts.ts";
import { cellKey, parseRangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetAnchorPoint,
  SpreadsheetDiagnostic,
  SpreadsheetHyperlink,
  SpreadsheetObject,
  SpreadsheetObjectAnchor,
} from "./model.ts";
import { assertWellFormedXml, attributes, decodeXml } from "./xml.ts";

const MAX_PROJECTED_HYPERLINK_CELLS = 100_000;
const MAX_PROJECTED_OBJECTS = 10_000;

type Relationship = Readonly<{
  id: string;
  target: string;
  targetMode?: string;
  type: string;
}>;

export type WorksheetProjection = Readonly<{
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  hyperlinkCount: number;
  hyperlinks: ReadonlyMap<string, SpreadsheetHyperlink>;
  objects: ReadonlyArray<SpreadsheetObject>;
  surfacedHyperlinkCount: number;
}>;

function directory(part: string): string {
  return part.slice(0, Math.max(0, part.lastIndexOf("/")));
}

function baseName(part: string): string {
  return part.slice(part.lastIndexOf("/") + 1);
}

function relationshipsPart(part: string): string {
  return `${directory(part)}/_rels/${baseName(part)}.rels`;
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const resolved: string[] = [];
  for (const segment of `${base}/${target}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function parseRelationships(xml: string): ReadonlyMap<string, Relationship> {
  const result = new Map<string, Relationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/giu)) {
    const attrs = attributes(match[1]);
    if (!attrs.Id || !attrs.Target || !attrs.Type) continue;
    result.set(attrs.Id, {
      id: attrs.Id,
      target: attrs.Target,
      ...(attrs.TargetMode ? { targetMode: attrs.TargetMode } : {}),
      type: attrs.Type,
    });
  }
  return result;
}

function readRelationships(
  archive: OoxmlArchive,
  ownerPart: string,
  diagnostics: SpreadsheetDiagnostic[],
  sheetId: string,
): ReadonlyMap<string, Relationship> {
  const part = relationshipsPart(ownerPart);
  if (!archive.has(part)) return new Map();
  try {
    const xml = archive.text(part);
    assertWellFormedXml(xml, part);
    return parseRelationships(xml);
  } catch (error) {
    diagnostics.push({
      code: "xlsx.relationships.malformed",
      message: error instanceof Error ? error.message : String(error),
      part,
      severity: "warning",
      sheetId,
    });
    return new Map();
  }
}

function safeExternalTarget(target: string): string | undefined {
  try {
    const url = new URL(target);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function localText(source: string, name: string): number | undefined {
  const value = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`,
    "iu",
  ).exec(source)?.[1];
  if (value === undefined) return undefined;
  const parsed = Number(decodeXml(value.replaceAll(/<[^>]+>/gu, "")));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function anchorPoint(source: string): SpreadsheetAnchorPoint | undefined {
  const column = localText(source, "col");
  const row = localText(source, "row");
  if (column === undefined || row === undefined || column < 0 || row < 0) return undefined;
  return {
    column: column + 1,
    columnOffsetEmu: localText(source, "colOff") ?? 0,
    row: row + 1,
    rowOffsetEmu: localText(source, "rowOff") ?? 0,
  };
}

function childBlock(source: string, name: string): string | undefined {
  return new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`,
    "iu",
  ).exec(source)?.[1];
}

function singletonAttributes(source: string, name: string): Readonly<Record<string, string>> {
  return attributes(
    new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*)\\/?>`, "iu").exec(source)?.[1] ?? "",
  );
}

function parseAnchor(
  kind: "absolute" | "one-cell" | "two-cell",
  source: string,
): SpreadsheetObjectAnchor | undefined {
  const extent = singletonAttributes(source, "ext");
  if (kind === "absolute") {
    const position = singletonAttributes(source, "pos");
    if (
      ![position.x, position.y, extent.cx, extent.cy].every((value) =>
        Number.isFinite(Number(value)),
      )
    )
      return undefined;
    return {
      kind,
      position: { xEmu: Number(position.x), yEmu: Number(position.y) },
      size: { heightEmu: Number(extent.cy), widthEmu: Number(extent.cx) },
    };
  }
  const from = anchorPoint(childBlock(source, "from") ?? "");
  if (!from) return undefined;
  if (kind === "two-cell") {
    const to = anchorPoint(childBlock(source, "to") ?? "");
    return to ? { from, kind, to } : undefined;
  }
  if (![extent.cx, extent.cy].every((value) => Number.isFinite(Number(value)))) return undefined;
  return {
    from,
    kind,
    size: { heightEmu: Number(extent.cy), widthEmu: Number(extent.cx) },
  };
}

function drawingObjects(input: {
  archive: OoxmlArchive;
  diagnostics: SpreadsheetDiagnostic[];
  drawingPart: string;
  sheetId: string;
}): readonly SpreadsheetObject[] {
  if (!input.archive.has(input.drawingPart)) {
    input.diagnostics.push({
      code: "xlsx.drawing.missing",
      message: `Drawing part is missing: ${input.drawingPart}`,
      part: input.drawingPart,
      severity: "warning",
      sheetId: input.sheetId,
    });
    return [
      {
        id: `${input.sheetId}:${input.drawingPart}:missing`,
        kind: "drawing",
        relationshipTarget: input.drawingPart,
        sheetId: input.sheetId,
      },
    ];
  }
  const xml = input.archive.text(input.drawingPart);
  try {
    assertWellFormedXml(xml, input.drawingPart);
  } catch (error) {
    input.diagnostics.push({
      code: "xlsx.drawing.malformed",
      message: error instanceof Error ? error.message : String(error),
      part: input.drawingPart,
      severity: "warning",
      sheetId: input.sheetId,
    });
    return [
      {
        id: `${input.sheetId}:${input.drawingPart}:malformed`,
        kind: "drawing",
        relationshipTarget: input.drawingPart,
        sheetId: input.sheetId,
      },
    ];
  }
  const relationships = readRelationships(
    input.archive,
    input.drawingPart,
    input.diagnostics,
    input.sheetId,
  );
  const objects: SpreadsheetObject[] = [];
  const anchorExpression =
    /<(?:[\w.-]+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?\1>/giu;
  let index = 0;
  for (const match of xml.matchAll(anchorExpression)) {
    index += 1;
    if (index > MAX_PROJECTED_OBJECTS) {
      input.diagnostics.push({
        code: "xlsx.drawing.too-many-objects",
        message: `Drawing part exceeds the ${MAX_PROJECTED_OBJECTS} object projection limit.`,
        part: input.drawingPart,
        severity: "warning",
        sheetId: input.sheetId,
      });
      break;
    }
    const anchorKind =
      match[1] === "twoCellAnchor"
        ? "two-cell"
        : match[1] === "oneCellAnchor"
          ? "one-cell"
          : "absolute";
    const body = match[2];
    const chartRelationshipId = /<(?:[\w.-]+:)?chart\b[^>]*\br:id=["']([^"']+)["']/iu.exec(
      body,
    )?.[1];
    const imageRelationshipId = /<(?:[\w.-]+:)?blip\b[^>]*\br:embed=["']([^"']+)["']/iu.exec(
      body,
    )?.[1];
    const relationshipId = chartRelationshipId ?? imageRelationshipId;
    const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
    const kind = chartRelationshipId ? "chart" : imageRelationshipId ? "image" : "drawing";
    const nonVisual = singletonAttributes(body, "cNvPr");
    const anchor = parseAnchor(anchorKind, body);
    if (!anchor) {
      input.diagnostics.push({
        code: "xlsx.drawing.anchor",
        message: `Drawing object ${nonVisual.name ?? index} has incomplete ${anchorKind} anchor metadata.`,
        part: input.drawingPart,
        severity: "warning",
        sheetId: input.sheetId,
      });
    }
    if (relationshipId && !relationship) {
      input.diagnostics.push({
        code: "xlsx.drawing.relationship",
        message: `Drawing object references missing relationship ${relationshipId}.`,
        part: relationshipsPart(input.drawingPart),
        severity: "warning",
        sheetId: input.sheetId,
      });
    }
    const chartPart =
      kind === "chart" && relationship
        ? resolvePart(directory(input.drawingPart), relationship.target)
        : undefined;
    const chart =
      chartPart && input.archive.has(chartPart)
        ? parseChart(chartPart, input.archive.text(chartPart))
        : undefined;
    objects.push({
      ...(anchor ? { anchor } : {}),
      ...(chart ? { chart } : {}),
      id: `${input.sheetId}:${input.drawingPart}:${nonVisual.id ?? index}`,
      kind,
      ...(nonVisual.name ? { name: nonVisual.name } : {}),
      relationshipTarget: relationship
        ? resolvePart(directory(input.drawingPart), relationship.target)
        : input.drawingPart,
      sheetId: input.sheetId,
    });
  }
  return objects;
}

export function projectWorksheetObjects(input: {
  archive: OoxmlArchive;
  sheetId: string;
  sheetPart: string;
  sheetXml: string;
}): WorksheetProjection {
  const diagnostics: SpreadsheetDiagnostic[] = [];
  const relationships = readRelationships(
    input.archive,
    input.sheetPart,
    diagnostics,
    input.sheetId,
  );
  const hyperlinks = new Map<string, SpreadsheetHyperlink>();
  let hyperlinkCount = 0;
  let surfacedHyperlinkCount = 0;
  for (const match of input.sheetXml.matchAll(/<hyperlink\b([^>]*)\/?\s*>/giu)) {
    hyperlinkCount += 1;
    const attrs = attributes(match[1]);
    let hyperlink: SpreadsheetHyperlink | undefined;
    if (attrs.location) {
      hyperlink = {
        kind: "internal",
        target: attrs.location,
        ...(attrs.tooltip ? { tooltip: attrs.tooltip } : {}),
      };
    } else if (attrs["r:id"]) {
      const relationship = relationships.get(attrs["r:id"]);
      const target = relationship ? safeExternalTarget(relationship.target) : undefined;
      if (
        relationship?.type.endsWith("/hyperlink") &&
        relationship.targetMode === "External" &&
        target
      ) {
        hyperlink = {
          kind: "external",
          target,
          ...(attrs.tooltip ? { tooltip: attrs.tooltip } : {}),
        };
      }
    }
    if (!hyperlink) {
      diagnostics.push({
        code: "xlsx.hyperlink.unsafe",
        message: `Hyperlink ${attrs.ref ?? hyperlinkCount} has no safe surfaced target.`,
        part: input.sheetPart,
        severity: "warning",
        sheetId: input.sheetId,
      });
      continue;
    }
    try {
      const range = parseRangeAddress(attrs.ref);
      if (
        (range.bottom - range.top + 1) * (range.right - range.left + 1) >
        MAX_PROJECTED_HYPERLINK_CELLS
      ) {
        throw new Error("Hyperlink range is too large to project safely.");
      }
      for (let row = range.top; row <= range.bottom; row += 1) {
        for (let column = range.left; column <= range.right; column += 1) {
          const key = cellKey(row, column);
          hyperlinks.set(key, hyperlink);
          if (hyperlinks.size > MAX_PROJECTED_HYPERLINK_CELLS) {
            hyperlinks.delete(key);
            throw new Error("Workbook contains too many projected hyperlink cells.");
          }
        }
      }
      surfacedHyperlinkCount += 1;
    } catch {
      diagnostics.push({
        code: "xlsx.hyperlink.reference",
        message: `Hyperlink has an invalid cell reference: ${attrs.ref ?? "missing"}.`,
        part: input.sheetPart,
        severity: "warning",
        sheetId: input.sheetId,
      });
    }
  }
  const objects: SpreadsheetObject[] = [];
  for (const match of input.sheetXml.matchAll(/<drawing\b([^>]*)\/?\s*>/giu)) {
    const relationshipId = attributes(match[1])["r:id"];
    const relationship = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!relationship?.type.endsWith("/drawing")) {
      diagnostics.push({
        code: "xlsx.drawing.relationship",
        message: `Worksheet drawing relationship is unavailable: ${relationshipId ?? "missing"}.`,
        part: relationshipsPart(input.sheetPart),
        severity: "warning",
        sheetId: input.sheetId,
      });
      continue;
    }
    objects.push(
      ...drawingObjects({
        archive: input.archive,
        diagnostics,
        drawingPart: resolvePart(directory(input.sheetPart), relationship.target),
        sheetId: input.sheetId,
      }),
    );
  }
  return { diagnostics, hyperlinkCount, hyperlinks, objects, surfacedHyperlinkCount };
}
