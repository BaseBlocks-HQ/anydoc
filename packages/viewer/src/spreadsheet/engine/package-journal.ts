import type { OoxmlArchive } from "./archive.ts";
import { attributes, escapeXml } from "./xml.ts";

const CONTENT_TYPES = "[Content_Types].xml";
const RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";

export type OoxmlRelationship = Readonly<{
  id: string;
  target: string;
  targetMode?: "External";
  type: string;
}>;

function directory(part: string): string {
  return part.slice(0, Math.max(0, part.lastIndexOf("/")));
}

function baseName(part: string): string {
  return part.slice(part.lastIndexOf("/") + 1);
}

export function relationshipsPart(part: string): string {
  return `${directory(part)}/_rels/${baseName(part)}.rels`;
}

export function parseOoxmlRelationships(xml: string): readonly OoxmlRelationship[] {
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/giu)]
    .map((match) => attributes(match[1]))
    .filter((value) => value.Id && value.Target && value.Type)
    .map((value) => ({
      id: value.Id,
      target: value.Target,
      ...(value.TargetMode === "External" ? { targetMode: "External" as const } : {}),
      type: value.Type,
    }));
}

function relationshipXml(relationships: readonly OoxmlRelationship[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIP_NAMESPACE}">${relationships
    .map(
      (relationship) =>
        `<Relationship Id="${escapeXml(relationship.id)}" Type="${escapeXml(relationship.type)}" Target="${escapeXml(relationship.target)}"${relationship.targetMode ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;
}

function nextId(values: readonly string[], prefix: string): string {
  const used = new Set(values);
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

export class OoxmlPackageJournal {
  readonly #archive: OoxmlArchive;
  readonly #encoder = new TextEncoder();
  readonly #overrides = new Map<string, Uint8Array>();
  readonly #removals = new Set<string>();

  constructor(archive: OoxmlArchive) {
    this.#archive = archive;
  }

  has(part: string): boolean {
    return !this.#removals.has(part) && (this.#overrides.has(part) || this.#archive.has(part));
  }

  text(part: string): string {
    const override = this.#overrides.get(part);
    if (override) return new TextDecoder().decode(override);
    if (this.#removals.has(part)) throw new Error(`Workbook part is removed: ${part}`);
    return this.#archive.text(part);
  }

  write(part: string, value: string | Uint8Array): void {
    this.#removals.delete(part);
    this.#overrides.set(part, typeof value === "string" ? this.#encoder.encode(value) : value);
  }

  remove(part: string): void {
    this.#overrides.delete(part);
    this.#removals.add(part);
  }

  allocatePart(directoryName: string, stem: string, extension = ".xml"): string {
    for (let index = 1; ; index += 1) {
      const part = `${directoryName}/${stem}${index}${extension}`;
      if (!this.has(part)) return part;
    }
  }

  relationships(ownerPart: string): readonly OoxmlRelationship[] {
    const part = relationshipsPart(ownerPart);
    return this.has(part) ? parseOoxmlRelationships(this.text(part)) : [];
  }

  addRelationship(
    ownerPart: string,
    relationship: Omit<OoxmlRelationship, "id"> & { id?: string },
  ): OoxmlRelationship {
    const existing = this.relationships(ownerPart);
    const created = {
      ...relationship,
      id:
        relationship.id ??
        nextId(
          existing.map(({ id }) => id),
          "rId",
        ),
    };
    this.write(relationshipsPart(ownerPart), relationshipXml([...existing, created]));
    return created;
  }

  removeRelationship(ownerPart: string, id: string): void {
    const part = relationshipsPart(ownerPart);
    const remaining = this.relationships(ownerPart).filter(
      (relationship) => relationship.id !== id,
    );
    if (remaining.length === 0) this.remove(part);
    else this.write(part, relationshipXml(remaining));
  }

  addContentType(part: string, contentType: string): void {
    const partName = `/${part}`;
    let xml = this.text(CONTENT_TYPES);
    const existing = [...xml.matchAll(/<Override\b([^>]*)\/?\s*>/giu)].some(
      (match) => attributes(match[1]).PartName === partName,
    );
    if (existing) return;
    xml = xml.replace(
      /<\/Types>\s*$/iu,
      `<Override PartName="${escapeXml(partName)}" ContentType="${escapeXml(contentType)}"/></Types>`,
    );
    this.write(CONTENT_TYPES, xml);
  }

  removeContentType(part: string): void {
    const partName = `/${part}`;
    const xml = this.text(CONTENT_TYPES).replace(
      /<Override\b([^>]*)\/?\s*>/giu,
      (match, rawAttributes: string) =>
        attributes(rawAttributes).PartName === partName ? "" : match,
    );
    this.write(CONTENT_TYPES, xml);
  }

  async export(): Promise<Uint8Array> {
    return this.#archive.export(this.#overrides, this.#removals);
  }
}
