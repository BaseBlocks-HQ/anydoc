import type { PresentationData } from "@aiden0z/pptx-renderer";

type Relationship = {
  readonly targetMode?: string;
  readonly type: string;
};

type RelationshipOwner = {
  readonly rels: Map<string, Relationship>;
};

function isExternal(relationship: Relationship): boolean {
  return relationship.targetMode?.trim().toLowerCase() === "external";
}

function isHyperlink(relationship: Relationship): boolean {
  return relationship.type.trim().toLowerCase().endsWith("/hyperlink");
}

function removeExternalMediaRelationships(owner: RelationshipOwner): number {
  let removed = 0;
  for (const [id, relationship] of owner.rels) {
    if (isExternal(relationship) && !isHyperlink(relationship)) {
      owner.rels.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Mutates a parsed presentation to remove externally loaded resources before
 * any slide, layout, or master is rendered. External hyperlink relationships
 * remain available for host-controlled navigation.
 */
export function blockExternalPresentationMedia(presentation: PresentationData): number {
  let removed = 0;
  for (const slide of presentation.slides) removed += removeExternalMediaRelationships(slide);
  for (const layout of presentation.layouts.values()) {
    removed += removeExternalMediaRelationships(layout);
  }
  for (const master of presentation.masters.values()) {
    removed += removeExternalMediaRelationships(master);
  }
  return removed;
}
