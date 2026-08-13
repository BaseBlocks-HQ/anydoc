# `@baseblocks/anydoc-presentation-viewer`

A safe, lazy React viewer for `.pptx` presentation data. Slides and embedded media are
materialized on demand; thumbnails, navigation, search highlighting, and zoom are included.

ZIP expansion and slide counts are bounded. The alpha parser observes cancellation between
synchronous parse phases; moving parsing to a dedicated worker is a post-v1 performance item.

External media relationships are removed before rendering. Hyperlinks never open on their
own: provide `onLink` and let the host decide whether and how to navigate.

```tsx
import { PresentationViewer } from "@baseblocks/anydoc-presentation-viewer";

<PresentationViewer
  source={arrayBuffer}
  onLink={({ url }) => openTrustedLink(url)}
  controls={{ render: (controls) => <MyPresentationControls {...controls} /> }}
/>
```

Omit `controls` to use the built-in controls. Set `controls={false}` to render no toolbar.
