---
{
  "id": "editorial-ui",
  "name": "Editorial UI",
  "version": "1.0.0",
  "category": "style",
  "summary": "Typography-led UI guidance for content-heavy, publishing, portfolio, and narrative product surfaces.",
  "tags": ["editorial", "typography", "content", "layout"],
  "appliesTo": ["content-heavy panels", "portfolio surfaces", "review pages", "publishing workflows"],
  "promptIncludes": [
    "Lead with typographic hierarchy before adding decoration.",
    "Use rhythm, alignment, and whitespace to make dense content scannable.",
    "Prefer purposeful imagery or previews only when they are supported by the selected context.",
    "Keep controls quiet and secondary to the content being edited or reviewed.",
    "Use this more freely on web/editorial surfaces and more cautiously inside desktop workspaces."
  ],
  "guardrails": [
    "Do not turn operational tools into marketing pages.",
    "Do not add unrelated imagery, large hero sections, or decorative copy.",
    "Do not change product structure without selection or source evidence."
  ]
}
---
# Editorial UI

Use this skill when the selected surface is driven by reading, review, narrative hierarchy, or content comparison.

For web surfaces, this can shape page rhythm and hierarchy. For desktop surfaces, keep it subordinate to `desktop-product-ui` so the result does not become a marketing or magazine layout.

Prioritize:
- Clear type scale with restrained display text.
- Strong alignment between headings, metadata, previews, and actions.
- Content-first layouts that preserve the user's editing or review flow.
- Secondary controls that stay available without competing with the content.

Avoid:
- Decorative cards around every section.
- Oversized marketing composition inside a desktop work surface.
- Generic magazine styling that ignores source evidence or existing shell density.
