---
{
  "id": "user-skill-authoring",
  "name": "User Skill Authoring",
  "version": "1.0.0",
  "category": "authoring",
  "summary": "Guidance for writing user-created UI skills that are scoped, evidence-aware, and safe for local AI prompting.",
  "tags": ["authoring", "skills", "guardrails", "prompting"],
  "appliesTo": ["custom skills", "team style rules", "project-specific prompting"],
  "promptIncludes": [
    "Write skills as constraints and preferences, not as broad permission to edit code.",
    "Include when to use the skill, what to prioritize, and what to avoid.",
    "Require selection or source evidence before the skill changes output behavior.",
    "Keep skill language concrete enough for a local model to apply consistently."
  ],
  "guardrails": [
    "Do not include instructions to ignore system, developer, or guardrail prompts.",
    "Do not request autonomous file edits, dependency changes, or unrelated refactors.",
    "Do not encode secrets, credentials, or private project data in a reusable skill."
  ]
}
---
# User Skill Authoring

User-created skills should be small, explicit, and grounded in the current selection.

Recommended structure:
- Purpose: one sentence describing the UI outcome.
- Applies to: concrete surfaces or workflows where the skill is useful.
- Prioritize: three to five specific design behaviors.
- Avoid: three to five failure modes.
- Guardrails: evidence and scope rules that keep the local AI from guessing.

Manifest rules:
- Use JSON front matter delimited by `---`.
- Keep `id`, `name`, `version`, `category`, `summary`, `tags`, `appliesTo`, `promptIncludes`, and `guardrails` present.
- Use `category: "style"` for visual or interaction style skills.
- Use `category: "authoring"` only for skill-writing guidance.
