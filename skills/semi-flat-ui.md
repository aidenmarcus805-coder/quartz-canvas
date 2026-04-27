---
{
  "id": "semi-flat-ui",
  "name": "Semi Flat UI",
  "version": "1.0.0",
  "category": "style",
  "summary": "Modern semi-flat guidance using subtle depth, crisp geometry, and practical visual hierarchy.",
  "tags": ["semi-flat", "depth", "geometry", "modern"],
  "appliesTo": ["desktop panels", "tool surfaces", "dashboards", "component libraries"],
  "promptIncludes": [
    "Use shallow depth only to separate interactive layers.",
    "Keep radii, borders, and shadows consistent with the selected UI system.",
    "Make state visible through contrast, structure, and affordance before decoration.",
    "Prefer crisp component geometry over ornamental effects."
  ],
  "guardrails": [
    "Do not add floating decorative blobs, heavy gradients, or nested card stacks.",
    "Do not increase radius or shadow depth without a functional reason.",
    "Do not alter unrelated components to chase visual consistency."
  ]
}
---
# Semi Flat UI

Use this skill when the selected UI needs a polished modern feel while staying usable and restrained.

Prioritize:
- Clear planes for navigation, work surfaces, popovers, and inspectors.
- Subtle borders and shadows that communicate layering.
- Consistent spacing, corner radius, and state treatment.
- Functional contrast between enabled, hovered, selected, and disabled controls.

Avoid:
- Heavy skeuomorphic depth.
- Decorative gradients used as the main design idea.
- Cards inside cards or panels that reduce usable space.
