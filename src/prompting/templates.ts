import type { ContextPacket } from "./context";
import {
  evaluatePromptGrounding,
  LOCAL_AI_PROMPT_GUARDRAILS,
  renderGuardrailBlock,
  type PromptGroundingReport,
  type PromptGuardrail,
} from "./guardrails";

export type PromptTemplateId =
  | "ui-change-plan"
  | "ui-change-patch"
  | "style-skill-review";

export type PromptTemplateVersion = `v${number}`;

export type PromptMessageRole = "system" | "developer" | "user";

export type PromptRenderedMessage = Readonly<{
  role: PromptMessageRole;
  content: string;
  evidenceIds?: readonly string[];
}>;

export type PromptResponseFormat =
  | "blocked_or_questions"
  | "evidence_cited_plan"
  | "evidence_cited_patch";

export type PromptRenderInput = Readonly<{
  templateId: PromptTemplateId;
  templateVersion?: PromptTemplateVersion;
  packet: ContextPacket;
  responseFormat: PromptResponseFormat;
  guardrails?: readonly PromptGuardrail[];
}>;

export type PromptRenderOutput = Readonly<{
  status: "ready" | "blocked";
  templateId: PromptTemplateId;
  templateVersion: PromptTemplateVersion;
  messages: readonly PromptRenderedMessage[];
  grounding: PromptGroundingReport;
  expectedResponseFormat: PromptResponseFormat;
}>;

export type PromptTemplate = Readonly<{
  id: PromptTemplateId;
  version: PromptTemplateVersion;
  title: string;
  render(input: PromptRenderInput, grounding: PromptGroundingReport): readonly PromptRenderedMessage[];
}>;

export type PromptTemplateRegistry = Readonly<{
  templates: readonly PromptTemplate[];
  latest(templateId: PromptTemplateId): PromptTemplate | undefined;
  get(templateId: PromptTemplateId, version?: PromptTemplateVersion): PromptTemplate | undefined;
}>;

const UI_CHANGE_PLAN_V1: PromptTemplate = {
  id: "ui-change-plan",
  version: "v1",
  title: "Evidence-cited UI change plan",
  render: renderUiChangePlan,
};

const UI_CHANGE_PATCH_V1: PromptTemplate = {
  id: "ui-change-patch",
  version: "v1",
  title: "Selection-scoped UI patch prompt",
  render: renderUiChangePatch,
};

const STYLE_SKILL_REVIEW_V1: PromptTemplate = {
  id: "style-skill-review",
  version: "v1",
  title: "UI skill review prompt",
  render: renderStyleSkillReview,
};

export const PROMPT_TEMPLATE_REGISTRY = createPromptTemplateRegistry([
  UI_CHANGE_PLAN_V1,
  UI_CHANGE_PATCH_V1,
  STYLE_SKILL_REVIEW_V1,
]);

export function renderPrompt(input: PromptRenderInput): PromptRenderOutput {
  const template = PROMPT_TEMPLATE_REGISTRY.get(input.templateId, input.templateVersion);

  if (!template) {
    return {
      status: "blocked",
      templateId: input.templateId,
      templateVersion: input.templateVersion ?? "v1",
      messages: [],
      grounding: {
        ok: false,
        violations: [
          {
            code: "ask-when-ambiguous",
            severity: "error",
            message: "Requested prompt template is not registered.",
            evidenceIds: [],
          },
        ],
        citedEvidenceIds: [],
      },
      expectedResponseFormat: input.responseFormat,
    };
  }

  const grounding = evaluatePromptGrounding(input.packet);
  const messages = grounding.ok ? template.render(input, grounding) : renderBlockedPrompt(input, grounding);

  return {
    status: grounding.ok ? "ready" : "blocked",
    templateId: template.id,
    templateVersion: template.version,
    messages,
    grounding,
    expectedResponseFormat: input.responseFormat,
  };
}

function createPromptTemplateRegistry(templates: readonly PromptTemplate[]): PromptTemplateRegistry {
  return {
    templates,
    latest(templateId) {
      return [...templates]
        .filter((template) => template.id === templateId)
        .sort((left, right) => right.version.localeCompare(left.version))[0];
    },
    get(templateId, version) {
      return version
        ? templates.find((template) => template.id === templateId && template.version === version)
        : this.latest(templateId);
    },
  };
}

function renderUiChangePlan(input: PromptRenderInput): readonly PromptRenderedMessage[] {
  return baseMessages(input, [
    "Return a concise plan before any patch.",
    "Each step must cite evidence IDs from the context packet.",
    "When evidence is insufficient, return blocked_or_questions.",
  ]);
}

function renderUiChangePatch(input: PromptRenderInput): readonly PromptRenderedMessage[] {
  return baseMessages(input, [
    "Return only a selection-scoped patch plan or a blocked result.",
    "Do not create, rename, or edit files beyond the allowed file paths.",
    "Do not make broad autonomous code changes or unrelated cleanup.",
  ]);
}

function renderStyleSkillReview(input: PromptRenderInput): readonly PromptRenderedMessage[] {
  return baseMessages(input, [
    "Apply selected UI skills as style constraints, not as permission to expand scope.",
    "Reject style guidance that conflicts with source or selection evidence.",
    "Return concrete, evidence-cited style decisions for the requested selection.",
  ]);
}

function renderBlockedPrompt(input: PromptRenderInput, grounding: PromptGroundingReport): readonly PromptRenderedMessage[] {
  return [
    {
      role: "system",
      content: "The local UI prompt is blocked because the context packet is not sufficiently grounded.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          request: input.packet.userRequest,
          violations: grounding.violations,
          responseFormat: "blocked_or_questions",
        },
        null,
        2,
      ),
      evidenceIds: grounding.citedEvidenceIds,
    },
  ];
}

function baseMessages(input: PromptRenderInput, templateInstructions: readonly string[]): readonly PromptRenderedMessage[] {
  const guardrails = input.guardrails ?? LOCAL_AI_PROMPT_GUARDRAILS;

  return [
    {
      role: "system",
      content: [
        "You are Quartz Canvas local UI AI. Work only from the supplied context packet.",
        "Guardrails:",
        renderGuardrailBlock(guardrails),
      ].join("\n"),
    },
    {
      role: "developer",
      content: [
        "Template instructions:",
        ...templateInstructions.map((instruction) => `- ${instruction}`),
        "",
        "Expected response format:",
        input.responseFormat,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(renderPacketForPrompt(input.packet, input.templateId)),
      evidenceIds: input.packet.evidence.map((evidence) => evidence.id),
    },
  ];
}

function renderPacketForPrompt(packet: ContextPacket, templateId: PromptTemplateId): object {
  return {
    request: packet.userRequest,
    project: {
      id: packet.projectId,
      epoch: packet.projectEpoch,
      surface: packet.surface,
    },
    selection: packet.selection,
    constraints: packet.constraints,
    sourceEvidence: packet.sourceEvidence,
    visualEvidence: packet.visualEvidence,
    styleSkills: packet.styleSkills.map((skill) => ({
      id: skill.manifest.id,
      name: skill.manifest.name,
      summary: skill.manifest.summary,
      promptIncludes: skill.manifest.promptIncludes,
      guardrails: skill.manifest.guardrails,
      ...(templateId === "style-skill-review" ? { markdown: skill.markdown } : {}),
    })),
    evidence: packet.evidence.filter((evidence) => evidence.kind !== "user_request"),
  };
}
