const URL_ATTRIBUTE_NAMES = new Set(["href", "poster", "src", "xlink:href"]);
const BLOCKED_ELEMENTS = "base,embed,form,iframe,link,meta,object,script";
const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
const CSS_IMPORT = /@import[^;]+;?/giu;

export function isSafeEmbeddedResourceUrl(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized.startsWith("data:image/") || normalized.startsWith("blob:");
}

function sanitizeCss(css: string, allowExternalResource?: (url: string, kind: string) => boolean) {
  return css.replace(CSS_IMPORT, "").replace(CSS_URL, (_match, _quote, url: string) => {
    return isSafeEmbeddedResourceUrl(url) || allowExternalResource?.(url, "style") === true
      ? `url(${JSON.stringify(url)})`
      : "none";
  });
}

export function sanitizeDocxDom(
  root: HTMLElement,
  allowExternalResource?: (url: string, kind: string) => boolean,
) {
  root.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        element.setAttribute("style", sanitizeCss(attribute.value, allowExternalResource));
        continue;
      }
      if (name === "srcset") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (!URL_ATTRIBUTE_NAMES.has(name)) continue;
      const isNavigation = name === "href" && element instanceof HTMLAnchorElement;
      if (isNavigation) {
        let parsed: URL | null = null;
        try {
          parsed = new URL(attribute.value, globalThis.location?.href);
        } catch {
          // Invalid links become inert.
        }
        if (!parsed || !new Set(["http:", "https:", "mailto:"]).has(parsed.protocol)) {
          element.removeAttribute(attribute.name);
        } else {
          element.setAttribute("rel", "noopener noreferrer");
          element.setAttribute("target", "_blank");
        }
        continue;
      }
      if (!isSafeEmbeddedResourceUrl(attribute.value) && allowExternalResource?.(attribute.value, name) !== true) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  root.querySelectorAll("style").forEach((style) => {
    style.textContent = sanitizeCss(style.textContent ?? "", allowExternalResource);
  });
}

export function clearSearchHighlights(root: HTMLElement) {
  root.querySelectorAll("mark[data-anydoc-search]").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  });
  root.normalize();
}

export function highlightText(root: HTMLElement, query: string): HTMLElement[] {
  clearSearchHighlights(root);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest("style,script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const matches: HTMLElement[] = [];
  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    const lower = value.toLocaleLowerCase();
    let found = lower.indexOf(needle);
    if (found < 0) continue;
    let cursor = 0;
    const fragment = document.createDocumentFragment();
    while (found >= 0) {
      fragment.append(value.slice(cursor, found));
      const mark = document.createElement("mark");
      mark.dataset.anydocSearch = "true";
      mark.textContent = value.slice(found, found + needle.length);
      fragment.append(mark);
      matches.push(mark);
      cursor = found + needle.length;
      found = lower.indexOf(needle, cursor);
    }
    fragment.append(value.slice(cursor));
    node.replaceWith(fragment);
  }
  return matches;
}
