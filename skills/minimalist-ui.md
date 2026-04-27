---
{
  "id": "minimalist-ui",
  "name": "Minimalist UI",
  "version": "1.0.0",
  "category": "style",
  "summary": "Low-noise UI guidance for direct, focused workflows where every visible element must earn its place.",
  "tags": ["minimal", "quiet", "focus", "utility"],
  "appliesTo": ["settings panels", "focused tools", "simple inspectors", "single-purpose workflows"],
  "promptIncludes": [
    "Remove visual noise before adding new structure.",
    "Use plain hierarchy, predictable spacing, and explicit affordances.",
    "Prefer one clear primary action per local task area.",
    "Keep labels short and concrete.",
    "Respect the detected surface route: compact and tool-like for desktop, more open and editorial for web."
  ],
  "guardrails": [
    "Do not remove necessary state, labels, or error feedback.",
    "Do not make controls ambiguous for the sake of visual simplicity.",
    "Do not broaden scope beyond the selected surface."
  ]
}
---
# Minimalist UI

Use this skill when the selection should feel calm, direct, and low friction.

Use this as a companion skill, not the main route. Pair it with `desktop-product-ui` for desktop surfaces and `web-creative-ui` for web surfaces.

Prioritize:
- Fewer surfaces, fewer accents, and fewer competing actions.
- Stable spacing and predictable control placement.
- Clear empty, loading, success, and error states when the selected context includes those states.
- Text that names the user's task without explaining the product.

Avoid:
- Hidden controls that make common work harder.
- Removing information needed for decision-making.
- A one-note color palette that makes state hard to scan.
