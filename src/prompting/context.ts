import type {
  ProjectEpoch,
  ProjectId,
  SelectionAuthorityLevel,
  SelectionId,
  SourceCandidateResult,
} from "../shared/types";
import type { UiStyleSkillDocument } from "./skills";

export type EvidenceConfidenceBand = SourceCandidateResult["confidence"]["band"];

export type ContextEvidenceId = string;

export type ContextEvidenceKind =
  | "selection"
  | "source"
  | "visual"
  | "user_request"
  | "project"
  | "style_skill";

export type ContextEvidenceReference = Readonly<{
  id: ContextEvidenceId;
  kind: ContextEvidenceKind;
  label: string;
  summary: string;
  confidence: EvidenceConfidenceBand;
}>;

export type SourceExcerpt = Readonly<{
  text: string;
  startLine?: number;
  endLine?: number;
}>;

export type ContextSourceEvidence = Readonly<{
  evidenceId: ContextEvidenceId;
  candidate: SourceCandidateResult;
  role: "primary" | "supporting" | "conflicting";
  excerpt?: SourceExcerpt;
}>;

export type ContextVisualEvidence = Readonly<{
  evidenceId: ContextEvidenceId;
  label: string;
  description: string;
  authority: SelectionAuthorityLevel;
}>;

export type ContextSelection = Readonly<{
  selectionId: SelectionId;
  authority: SelectionAuthorityLevel;
  nodeIds: readonly string[];
  summary: string;
  evidenceIds: readonly ContextEvidenceId[];
}>;

export type ApplicationSurfaceKind = "desktop" | "web" | "unknown";

export type ContextSurface = Readonly<{
  kind: ApplicationSurfaceKind;
  signals: readonly string[];
}>;

export type PromptScopeConstraints = Readonly<{
  selectionOnly: boolean;
  allowedFilePaths: readonly string[];
  forbiddenFileGlobs: readonly string[];
  maxFilesToTouch: number;
  allowBroadRefactors: false;
  requireEvidenceCitations: boolean;
}>;

export type ContextPacket = Readonly<{
  packetId: string;
  projectId: ProjectId;
  projectEpoch: ProjectEpoch;
  assembledAt: string;
  userRequest: string;
  selection: ContextSelection;
  sourceEvidence: readonly ContextSourceEvidence[];
  visualEvidence: readonly ContextVisualEvidence[];
  styleSkills: readonly UiStyleSkillDocument[];
  surface: ContextSurface;
  evidence: readonly ContextEvidenceReference[];
  constraints: PromptScopeConstraints;
}>;

export type ContextAssemblyInput = Readonly<{
  projectId: ProjectId;
  projectEpoch: ProjectEpoch;
  userRequest: string;
  selection: ContextSelection;
  sourceEvidence: readonly ContextSourceEvidence[];
  visualEvidence?: readonly ContextVisualEvidence[];
  styleSkills?: readonly UiStyleSkillDocument[];
  surface?: Partial<ContextSurface>;
  constraints?: Partial<PromptScopeConstraints>;
}>;

export type ContextAssemblyResult =
  | { readonly ok: true; readonly packet: ContextPacket }
  | { readonly ok: false; readonly reason: string };

export type ContextPacketAssembler = Readonly<{
  assemble(input: ContextAssemblyInput, signal?: AbortSignal): Promise<ContextAssemblyResult> | ContextAssemblyResult;
}>;

export type ContextProvider<TEvidence> = Readonly<{
  id: string;
  collect(input: ContextAssemblyInput, signal?: AbortSignal): Promise<TEvidence> | TEvidence;
}>;

const DEFAULT_CONSTRAINTS: PromptScopeConstraints = {
  selectionOnly: true,
  allowedFilePaths: [],
  forbiddenFileGlobs: [],
  maxFilesToTouch: 1,
  allowBroadRefactors: false,
  requireEvidenceCitations: true,
};

export function assembleContextPacket(input: ContextAssemblyInput): ContextAssemblyResult {
  const userRequest = input.userRequest.trim();

  if (userRequest.length === 0) {
    return { ok: false, reason: "A user request is required to assemble a prompt context packet." };
  }

  const sourceEvidence = input.sourceEvidence;
  const visualEvidence = input.visualEvidence ?? [];
  const styleSkills = input.styleSkills ?? [];
  const surface: ContextSurface = {
    kind: input.surface?.kind ?? "unknown",
    signals: input.surface?.signals ?? [],
  };

  const evidence: ContextEvidenceReference[] = [
    {
      id: "user-request",
      kind: "user_request",
      label: "User request",
      summary: userRequest,
      confidence: "high",
    },
    {
      id: input.selection.selectionId,
      kind: "selection",
      label: "Current selection",
      summary: input.selection.summary,
      confidence: authorityToConfidence(input.selection.authority),
    },
    ...sourceEvidence.map((source) => ({
      id: source.evidenceId,
      kind: "source" as const,
      label: source.candidate.path,
      summary: source.excerpt?.text ?? source.candidate.confidence.reasons.join("; "),
      confidence: source.candidate.confidence.band,
    })),
    ...visualEvidence.map((visual) => ({
      id: visual.evidenceId,
      kind: "visual" as const,
      label: visual.label,
      summary: visual.description,
      confidence: authorityToConfidence(visual.authority),
    })),
    ...styleSkills.map((skill) => ({
      id: skill.manifest.id,
      kind: "style_skill" as const,
      label: skill.manifest.name,
      summary: skill.manifest.summary,
      confidence: "high" as const,
    })),
    ...(surface.kind === "unknown"
      ? []
      : [
          {
            id: "application-surface",
            kind: "project" as const,
            label: "Application surface",
            summary: [surface.kind, ...surface.signals].join("; "),
            confidence: surface.signals.length > 0 ? ("high" as const) : ("likely" as const),
          },
        ]),
  ];

  return {
    ok: true,
    packet: {
      packetId: `context-${input.projectId}-${input.projectEpoch}`,
      projectId: input.projectId,
      projectEpoch: input.projectEpoch,
      assembledAt: new Date().toISOString(),
      userRequest,
      selection: input.selection,
      sourceEvidence,
      visualEvidence,
      styleSkills,
      surface,
      evidence,
      constraints: { ...DEFAULT_CONSTRAINTS, ...input.constraints },
    },
  };
}

function authorityToConfidence(authority: SelectionAuthorityLevel): EvidenceConfidenceBand {
  switch (authority) {
    case "patch_authoritative":
    case "source_confirm_required":
      return "high";
    case "inspect_only":
    case "visual_only":
      return "likely";
    case "stale":
      return "low";
    case "blocked":
      return "blocked";
  }
}
