export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function decodeXml(value: string): string {
  return value.replaceAll(
    /&#(x?[\dA-F]+);|&(amp|lt|gt|quot|apos);/giu,
    (entity, numeric, named) => {
      if (numeric) {
        const hexadecimal = String(numeric).toLowerCase().startsWith("x");
        return String.fromCodePoint(
          Number.parseInt(hexadecimal ? String(numeric).slice(1) : numeric, hexadecimal ? 16 : 10),
        );
      }
      return (
        ({ amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' } as const)[named as "amp"] ?? entity
      );
    },
  );
}

export function attributes(source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/gu)) {
    result[match[1]] = decodeXml(match[3]);
  }
  return result;
}

export function elementText(source: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(source);
  return match ? decodeXml(match[1].replaceAll(/<[^>]+>/gu, "")) : undefined;
}

export function replaceOrInsertElement(
  source: string,
  tag: string,
  replacement: string,
  beforeTags: readonly string[],
): string {
  const paired = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "iu");
  if (paired.test(source)) return source.replace(paired, replacement);
  const singleton = new RegExp(`<${tag}\\b[^>]*/>`, "iu");
  if (singleton.test(source)) return source.replace(singleton, replacement);
  for (const before of beforeTags) {
    const index = source.search(new RegExp(`<${before}\\b`, "iu"));
    if (index >= 0) return `${source.slice(0, index)}${replacement}${source.slice(index)}`;
  }
  return source.replace(/<\/worksheet>\s*$/iu, `${replacement}</worksheet>`);
}

export function replaceRootAttribute(
  source: string,
  tag: string,
  name: string,
  value: string,
): string {
  return source.replace(
    new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "iu"),
    (_whole, attributeSource: string, selfClosing: string) => {
      const attribute = new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, "iu");
      const next = attribute.test(attributeSource)
        ? attributeSource.replace(attribute, ` ${name}="${escapeXml(value)}"`)
        : `${attributeSource} ${name}="${escapeXml(value)}"`;
      return `<${tag}${next}${selfClosing}>`;
    },
  );
}

export function assertWellFormedXml(source: string, part: string): void {
  let failure: Error | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", (error: Error) => {
    failure = error;
  });
  parser.write(source).close();
  if (failure) throw new Error(`Workbook XML part is malformed: ${part}. ${failure.message}`);
}
import { SaxesParser } from "saxes";
