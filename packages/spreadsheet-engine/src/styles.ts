import type { SpreadsheetCellStyle, SpreadsheetColor } from "./model.ts";
import { attributes, escapeXml } from "./xml.ts";

type StyleReference = Readonly<{
  borderId: number;
  fillId: number;
  fontId: number;
  numFmtId: number;
}>;

const BUILTIN_FORMATS: Readonly<Record<number, string>> = {
  0: "General",
  1: "0",
  2: "0.00",
  9: "0%",
  10: "0.00%",
  14: "m/d/yy",
  49: "@",
};

function color(value: string | undefined): SpreadsheetColor | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^#/u, "").toUpperCase();
  if (/^[\dA-F]{8}$/u.test(normalized)) return `#${normalized.slice(2)}`;
  if (/^[\dA-F]{6}$/u.test(normalized)) return `#${normalized}`;
  return undefined;
}

function childElements(source: string, tag: string): readonly string[] {
  const block = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(source)?.[1];
  if (!block) return [];
  const singular = tag === "cellXfs" ? "xf" : tag.slice(0, -1);
  const expression =
    singular === "xf"
      ? /<xf\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/xf>)/giu
      : new RegExp(`<${singular}\\b[^>]*>[\\s\\S]*?<\\/${singular}>`, "giu");
  return [...block.matchAll(expression)].map((match) => match[0]);
}

function tagAttributes(source: string, tag: string): Readonly<Record<string, string>> {
  return attributes(new RegExp(`<${tag}\\b([^>]*)`, "iu").exec(source)?.[1] ?? "");
}

function parseFont(source: string): SpreadsheetCellStyle {
  const colorAttributes = tagAttributes(source, "color");
  const fontColor = color(colorAttributes.rgb);
  const fontFamily = tagAttributes(source, "name").val;
  const fontSize = Number(tagAttributes(source, "sz").val);
  return {
    ...(source.includes("<b") ? { bold: true } : {}),
    ...(fontColor ? { color: fontColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSize > 0 ? { fontSize } : {}),
    ...(source.includes("<i") ? { italic: true } : {}),
    ...(source.includes("<u") ? { underline: true } : {}),
  };
}

function parseFill(source: string): SpreadsheetCellStyle {
  const foreground = color(tagAttributes(source, "fgColor").rgb);
  return foreground ? { background: foreground } : {};
}

function parseBorder(source: string): SpreadsheetCellStyle {
  const sideColor = (side: string): SpreadsheetColor | undefined => {
    const block = new RegExp(`<${side}\\b[^>]*>([\\s\\S]*?)<\\/${side}>`, "iu").exec(source)?.[0];
    return block ? color(tagAttributes(block, "color").rgb) : undefined;
  };
  const bottom = sideColor("bottom");
  const left = sideColor("left");
  const right = sideColor("right");
  const top = sideColor("top");
  return {
    ...(bottom ? { borderBottom: bottom } : {}),
    ...(left ? { borderLeft: left } : {}),
    ...(right ? { borderRight: right } : {}),
    ...(top ? { borderTop: top } : {}),
  };
}

function fontXml(style: SpreadsheetCellStyle): string {
  return `<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}${style.underline ? "<u/>" : ""}${style.fontSize ? `<sz val="${style.fontSize}"/>` : ""}${style.color ? `<color rgb="FF${style.color.slice(1)}"/>` : ""}${style.fontFamily ? `<name val="${escapeXml(style.fontFamily)}"/>` : ""}</font>`;
}

function fillXml(style: SpreadsheetCellStyle): string {
  return style.background
    ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.background.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`
    : `<fill><patternFill patternType="none"/></fill>`;
}

function borderXml(style: SpreadsheetCellStyle): string {
  const side = (name: string, value: SpreadsheetColor | undefined) =>
    value ? `<${name} style="thin"><color rgb="FF${value.slice(1)}"/></${name}>` : `<${name}/>`;
  return `<border>${side("left", style.borderLeft)}${side("right", style.borderRight)}${side("top", style.borderTop)}${side("bottom", style.borderBottom)}<diagonal/></border>`;
}

function differentialXml(style: SpreadsheetCellStyle): string {
  return `<dxf>${Object.keys(style).some((key) => ["bold", "color", "fontFamily", "fontSize", "italic", "underline"].includes(key)) ? fontXml(style) : ""}${style.background ? fillXml(style) : ""}${Object.keys(style).some((key) => key.startsWith("border")) ? borderXml(style) : ""}${style.numberFormat ? `<numFmt numFmtId="0" formatCode="${escapeXml(style.numberFormat)}"/>` : ""}</dxf>`;
}

function appendItems(
  source: string,
  collection: string,
  item: string,
  items: readonly string[],
): string {
  if (items.length === 0) return source;
  const expression = new RegExp(`<${collection}\\b([^>]*)>([\\s\\S]*?)<\\/${collection}>`, "iu");
  return source.replace(expression, (_whole, attributeSource: string, content: string) => {
    const attrs = attributes(attributeSource);
    const count = Number(
      attrs.count || [...content.matchAll(new RegExp(`<${item}\\b`, "giu"))].length,
    );
    const nextAttributes = /\bcount\s*=/iu.test(attributeSource)
      ? attributeSource.replace(/\bcount\s*=\s*(["'])\d+\1/iu, `count="${count + items.length}"`)
      : `${attributeSource} count="${count + items.length}"`;
    return `<${collection}${nextAttributes}>${content}${items.join("")}</${collection}>`;
  });
}

export class SpreadsheetStyleStore {
  readonly #borders: readonly SpreadsheetCellStyle[];
  readonly #fills: readonly SpreadsheetCellStyle[];
  readonly #fonts: readonly SpreadsheetCellStyle[];
  readonly #formats: Map<number, string>;
  readonly #references: readonly StyleReference[];
  readonly #resolved: SpreadsheetCellStyle[];
  readonly #source: string;
  readonly #addedBorders: string[] = [];
  readonly #addedFills: string[] = [];
  readonly #addedFonts: string[] = [];
  readonly #addedFormats: string[] = [];
  readonly #addedXfs: string[] = [];
  readonly #addedDxfs: string[] = [];
  readonly #differentials: SpreadsheetCellStyle[];
  readonly #registered = new Map<string, number>();
  readonly #registeredDifferentials = new Map<string, number>();

  constructor(source: string) {
    this.#source = source;
    this.#fonts = childElements(source, "fonts").map(parseFont);
    this.#fills = childElements(source, "fills").map(parseFill);
    this.#borders = childElements(source, "borders").map(parseBorder);
    this.#formats = new Map(
      Object.entries(BUILTIN_FORMATS).map(([id, format]) => [Number(id), format]),
    );
    for (const numFmt of source.matchAll(/<numFmt\b([^>]*)\/?\s*>/giu)) {
      const attrs = attributes(numFmt[1]);
      if (attrs.numFmtId && attrs.formatCode)
        this.#formats.set(Number(attrs.numFmtId), attrs.formatCode);
    }
    const xfs = childElements(source, "cellXfs");
    this.#references = xfs.map((xf) => {
      const attrs = attributes(/^<xf\b([^>]*)/iu.exec(xf)?.[1] ?? "");
      return {
        borderId: Number(attrs.borderId ?? 0),
        fillId: Number(attrs.fillId ?? 0),
        fontId: Number(attrs.fontId ?? 0),
        numFmtId: Number(attrs.numFmtId ?? 0),
      };
    });
    this.#resolved = xfs.map((xf, index): SpreadsheetCellStyle => {
      const reference = this.#references[index];
      const alignment = tagAttributes(xf, "alignment");
      const numberFormat = this.#formats.get(reference.numFmtId);
      return {
        ...this.#fonts[reference.fontId],
        ...this.#fills[reference.fillId],
        ...this.#borders[reference.borderId],
        ...(numberFormat ? { numberFormat } : {}),
        ...(alignment.horizontal === "center" || alignment.horizontal === "right"
          ? { horizontal: alignment.horizontal }
          : alignment.horizontal === "left"
            ? { horizontal: "left" as const }
            : {}),
        ...(alignment.vertical === "center"
          ? { vertical: "middle" as const }
          : alignment.vertical === "top" || alignment.vertical === "bottom"
            ? { vertical: alignment.vertical }
            : {}),
        ...(alignment.wrapText === "1" ? { wrapText: true } : {}),
      };
    });
    if (this.#resolved.length === 0) this.#resolved.push({ numberFormat: "General" });
    this.#differentials = childElements(source, "dxfs").map((dxf) => ({
      ...parseFont(dxf),
      ...parseFill(dxf),
      ...parseBorder(dxf),
      ...(tagAttributes(dxf, "numFmt").formatCode
        ? { numberFormat: tagAttributes(dxf, "numFmt").formatCode }
        : {}),
    }));
    this.#differentials.forEach((style, index) => {
      this.#registeredDifferentials.set(this.#canonical(style), index);
    });
  }

  resolve(styleId: number): SpreadsheetCellStyle {
    return this.#resolved[styleId] ?? this.#resolved[0] ?? {};
  }

  register(style: SpreadsheetCellStyle): number {
    const canonical = JSON.stringify(
      Object.fromEntries(Object.entries(style).sort(([a], [b]) => a.localeCompare(b))),
    );
    const existing = this.#registered.get(canonical);
    if (existing !== undefined) return existing;
    const fontId = this.#fonts.length + this.#addedFonts.length;
    const fillId = this.#fills.length + this.#addedFills.length;
    const borderId = this.#borders.length + this.#addedBorders.length;
    let numFmtId =
      [...this.#formats.keys()].find((id) => this.#formats.get(id) === style.numberFormat) ?? 0;
    if (style.numberFormat && numFmtId === 0 && style.numberFormat !== "General") {
      numFmtId =
        Math.max(
          164,
          ...this.#formats.keys(),
          ...this.#addedFormats.map((item) => Number(attributes(item).numFmtId)),
        ) + 1;
      this.#formats.set(numFmtId, style.numberFormat);
      this.#addedFormats.push(
        `<numFmt numFmtId="${numFmtId}" formatCode="${escapeXml(style.numberFormat)}"/>`,
      );
    }
    this.#addedFonts.push(fontXml(style));
    this.#addedFills.push(fillXml(style));
    this.#addedBorders.push(borderXml(style));
    const alignment = [
      style.horizontal ? `horizontal="${style.horizontal}"` : "",
      style.vertical ? `vertical="${style.vertical === "middle" ? "center" : style.vertical}"` : "",
      style.wrapText ? 'wrapText="1"' : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.#addedXfs.push(
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"${alignment ? ` applyAlignment="1"><alignment ${alignment}/></xf>` : "/>"}`,
    );
    const id = this.#resolved.length;
    this.#resolved.push(style);
    this.#registered.set(canonical, id);
    return id;
  }

  resolveDifferential(styleId: number): SpreadsheetCellStyle {
    return this.#differentials[styleId] ?? {};
  }

  registerDifferential(style: SpreadsheetCellStyle): number {
    const existing = this.#registeredDifferentials.get(this.#canonical(style));
    if (existing !== undefined) return existing;
    const id = this.#differentials.length;
    this.#differentials.push(style);
    this.#addedDxfs.push(differentialXml(style));
    this.#registeredDifferentials.set(this.#canonical(style), id);
    return id;
  }

  #canonical(style: SpreadsheetCellStyle): string {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(style).sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  }

  serialize(): string {
    let result = this.#source;
    result = appendItems(result, "fonts", "font", this.#addedFonts);
    result = appendItems(result, "fills", "fill", this.#addedFills);
    result = appendItems(result, "borders", "border", this.#addedBorders);
    result = appendItems(result, "cellXfs", "xf", this.#addedXfs);
    if (this.#addedDxfs.length > 0) {
      if (/<dxfs\b/iu.test(result)) result = appendItems(result, "dxfs", "dxf", this.#addedDxfs);
      else
        result = result.replace(
          /<\/styleSheet>\s*$/iu,
          `<dxfs count="${this.#addedDxfs.length}">${this.#addedDxfs.join("")}</dxfs></styleSheet>`,
        );
    }
    if (this.#addedFormats.length > 0) {
      if (/<numFmts\b/iu.test(result))
        result = appendItems(result, "numFmts", "numFmt", this.#addedFormats);
      else
        result = result.replace(
          /<fonts\b/iu,
          `<numFmts count="${this.#addedFormats.length}">${this.#addedFormats.join("")}</numFmts><fonts`,
        );
    }
    return result;
  }
}
