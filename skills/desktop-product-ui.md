---
{
  "id": "desktop-product-ui",
  "name": "Desktop Product UI",
  "version": "1.0.0",
  "category": "style",
  "summary": "Compact, professional UI guidance for desktop apps, native-feeling webviews, productivity tools, editors, and inspection workflows.",
  "tags": ["desktop", "productivity", "workspace", "inspector"],
  "appliesTo": ["multi-panel workspaces", "editors", "inspectors", "data managers", "toolbars"],
  "promptIncludes": [
    "Treat this surface as a desktop application, not a public website or marketing page.",
    "Preserve shell stability, panel ownership, and repeat-work ergonomics.",
    "Use compact but readable layout for expert workflows.",
    "Prefer panes, rails, toolbars, rows, inspectors, and stable work surfaces over decorative cards.",
    "Expose frequent actions while keeping advanced controls contextually available."
  ],
  "guardrails": [
    "Do not introduce landing-page, hero, portfolio, or SaaS-marketing patterns into the workspace.",
    "Do not use card-heavy layouts for dense operational data.",
    "Do not add expressive imagery, oversized type, or decorative whitespace unless the selected surface already uses it.",
    "Do not hide critical actions behind pointer-only interactions."
  ]
}
---
# Desktop Product UI

Use this skill when `surface.kind` is `desktop`, or when the project evidence points to Tauri, Electron, a native-feeling webview, an editor, inspector, settings app, data manager, dashboard-like internal tool, or long-running productivity surface.

In local model prompts, this skill should stay short. The model needs the surface route, the selected UI evidence, and the rules below. It does not need a full design essay.

Prioritize:
- Persistent navigation, workbench, preview, and inspector ownership.
- Compact controls with obvious state, hover, disabled, loading, and focus behavior.
- Resizable or stable regions when the selected workflow depends on comparison.
- Scannable tables, lists, and grouped controls instead of decorative card grids.
- Fewer wrappers, fewer badges, fewer subtitles, and fewer helper paragraphs.
- Existing app tokens, fonts, spacing, and primitives before new styling.

Avoid:
- Big hero headers or explanatory product copy.
- Layout shifts caused by hover labels, counters, or dynamic text.
- Pointer-only workflows for important actions.
- Public-site composition: split heroes, feature cards, landing sections, playful copy, oversized imagery, decorative gradients.
- Card soup, nested panels, rounded boxes around every subsection, and arbitrary accent colors.
