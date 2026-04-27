export const BUILT_IN_UI_SKILL_IDS = [
  "editorial-ui",
  "minimalist-ui",
  "semi-flat-ui",
  "apple-ui",
  "desktop-product-ui",
  "web-creative-ui",
  "user-skill-authoring",
] as const;

export type BuiltInUiSkillId = (typeof BUILT_IN_UI_SKILL_IDS)[number];

export type UiSurfaceKind = "desktop" | "web" | "unknown";

export type UiSkillCategory = "style" | "authoring";

export type UiStyleSkillManifest = Readonly<{
  id: string;
  name: string;
  version: string;
  category: UiSkillCategory;
  summary: string;
  tags: readonly string[];
  appliesTo: readonly string[];
  promptIncludes: readonly string[];
  guardrails: readonly string[];
}>;

export type UiStyleSkillDocument = Readonly<{
  manifest: UiStyleSkillManifest;
  markdown: string;
  sourcePath: string;
  loadedAt: string;
}>;

export type BuiltInUiSkillReference = Readonly<{
  id: BuiltInUiSkillId;
  path: string;
}>;

export type SkillLoadResult =
  | { readonly ok: true; readonly skill: UiStyleSkillDocument }
  | { readonly ok: false; readonly sourcePath: string; readonly reason: string };

export type UiStyleSkillLoader = Readonly<{
  listBuiltIns(): Promise<readonly BuiltInUiSkillReference[]> | readonly BuiltInUiSkillReference[];
  loadSkill(sourcePath: string, signal?: AbortSignal): Promise<SkillLoadResult> | SkillLoadResult;
  loadUserSkills?(directoryPath: string, signal?: AbortSignal): Promise<readonly SkillLoadResult[]> | readonly SkillLoadResult[];
}>;

export const BUILT_IN_UI_SKILLS = [
  { id: "editorial-ui", path: "skills/editorial-ui.md" },
  { id: "minimalist-ui", path: "skills/minimalist-ui.md" },
  { id: "semi-flat-ui", path: "skills/semi-flat-ui.md" },
  { id: "apple-ui", path: "skills/apple-ui.md" },
  { id: "desktop-product-ui", path: "skills/desktop-product-ui.md" },
  { id: "web-creative-ui", path: "skills/web-creative-ui.md" },
  { id: "user-skill-authoring", path: "skills/user-skill-authoring.md" },
] as const satisfies readonly BuiltInUiSkillReference[];

export function defaultUiSkillIdsForSurface(surfaceKind: UiSurfaceKind): readonly BuiltInUiSkillId[] {
  switch (surfaceKind) {
    case "desktop":
      return ["desktop-product-ui", "minimalist-ui", "apple-ui"];
    case "web":
      return ["web-creative-ui", "minimalist-ui", "semi-flat-ui"];
    case "unknown":
      return ["minimalist-ui", "semi-flat-ui"];
  }
}

export function parseUiStyleSkillMarkdown(markdown: string, sourcePath: string): SkillLoadResult {
  const frontMatter = extractJsonFrontMatter(markdown);

  if (!frontMatter.ok) {
    return { ok: false, sourcePath, reason: frontMatter.reason };
  }

  const manifest = parseManifest(frontMatter.json);

  if (!manifest.ok) {
    return { ok: false, sourcePath, reason: manifest.reason };
  }

  return {
    ok: true,
    skill: {
      manifest: manifest.value,
      markdown: frontMatter.body.trim(),
      sourcePath,
      loadedAt: new Date().toISOString(),
    },
  };
}

type FrontMatterResult =
  | { readonly ok: true; readonly json: unknown; readonly body: string }
  | { readonly ok: false; readonly reason: string };

type ManifestResult =
  | { readonly ok: true; readonly value: UiStyleSkillManifest }
  | { readonly ok: false; readonly reason: string };

function extractJsonFrontMatter(markdown: string): FrontMatterResult {
  const trimmed = markdown.trimStart();

  if (!trimmed.startsWith("---")) {
    return { ok: false, reason: "Skill markdown must start with JSON front matter delimited by ---." };
  }

  const closingIndex = trimmed.indexOf("\n---", 3);

  if (closingIndex === -1) {
    return { ok: false, reason: "Skill markdown is missing the closing front matter delimiter." };
  }

  const rawManifest = trimmed.slice(3, closingIndex).trim();
  const body = trimmed.slice(closingIndex + 4);

  try {
    return { ok: true, json: JSON.parse(rawManifest) as unknown, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    return { ok: false, reason: `Skill front matter is not valid JSON: ${message}` };
  }
}

function parseManifest(value: unknown): ManifestResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "Skill manifest must be a JSON object." };
  }

  const category = value.category;

  if (category !== "style" && category !== "authoring") {
    return { ok: false, reason: "Skill manifest category must be style or authoring." };
  }

  const manifest = {
    id: readString(value, "id"),
    name: readString(value, "name"),
    version: readString(value, "version"),
    category,
    summary: readString(value, "summary"),
    tags: readStringArray(value, "tags"),
    appliesTo: readStringArray(value, "appliesTo"),
    promptIncludes: readStringArray(value, "promptIncludes"),
    guardrails: readStringArray(value, "guardrails"),
  } satisfies UiStyleSkillManifest;

  const missingKey = Object.entries(manifest).find(([, fieldValue]) => {
    if (Array.isArray(fieldValue)) {
      return fieldValue.length === 0;
    }

    return typeof fieldValue === "string" && fieldValue.trim().length === 0;
  });

  if (missingKey) {
    return { ok: false, reason: `Skill manifest field ${missingKey[0]} is required.` };
  }

  return { ok: true, value: manifest };
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
