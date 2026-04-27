---
{
  "id": "web-creative-ui",
  "name": "Web Creative UI",
  "version": "1.0.0",
  "category": "style",
  "summary": "Creative but consistent guidance for web apps, public websites, landing pages, portfolios, docs, and browser-first product surfaces.",
  "tags": ["web", "creative", "marketing", "public"],
  "appliesTo": ["public websites", "landing pages", "portfolio surfaces", "browser-first apps"],
  "promptIncludes": [
    "Treat this surface as a web experience unless project evidence proves it is desktop app chrome.",
    "Allow more expressive layout, imagery, brand mood, and composition than desktop product UI.",
    "Keep navigation, typography, spacing, and component rhythm consistent across the page.",
    "Use visual assets when they help explain the product, place, person, offer, state, or workflow.",
    "Preserve usability, responsive fit, accessible contrast, and clear hierarchy before decorative ambition."
  ],
  "guardrails": [
    "Do not import desktop-workspace density rules into public web pages or brand surfaces.",
    "Do not create generic SaaS sections when the selected context calls for a specific product or brand.",
    "Do not let creativity break hierarchy, responsiveness, task clarity, or text fit.",
    "Do not use web expressiveness for desktop app shells, inspectors, or settings surfaces."
  ]
}
---
# Web Creative UI

Use this skill when `surface.kind` is `web`, or when project evidence points to a browser-first site, public product page, landing page, docs, portfolio, editorial page, ecommerce page, or creative web app.

In local model prompts, this skill should be concise. Include the route, selected evidence, and only these practical rules unless the user explicitly asks for deeper style exploration.

Prioritize:
- A clear first-viewport signal for the product, brand, object, or offer.
- More expressive composition than desktop tools while preserving a coherent system.
- Purposeful imagery, media, or interactive visuals when the selected context supports them.
- Responsive layouts where text, controls, and media remain readable and non-overlapping.
- Existing brand/type/color patterns before inventing a new visual language.
- Web-level affordances: navigation clarity, page rhythm, calls to action, content hierarchy, and mobile fit.

Avoid:
- Dense inspector/tooling conventions unless the page is actually a web app workbench.
- Decoration that could belong to any unrelated startup page.
- One-off visual flourishes that conflict with existing typography, spacing, or component patterns.
- Default dashboard/card-grid layouts when the page needs a more authored web composition.
