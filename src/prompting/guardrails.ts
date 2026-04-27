import type { ContextPacket, ContextSourceEvidence } from "./context";

export type PromptGuardrailId =
  | "cite-selection-evidence"
  | "stay-inside-selection"
  | "respect-source-authority"
  | "avoid-autonomous-coding"
  | "ask-when-ambiguous";

export type PromptGuardrail = Readonly<{
  id: PromptGuardrailId;
  severity: "error" | "warning";
  instruction: string;
}>;

export type PromptGroundingViolation = Readonly<{
  code: PromptGuardrailId;
  severity: "error" | "warning";
  message: string;
  evidenceIds: readonly string[];
}>;

export type PromptGroundingReport = Readonly<{
  ok: boolean;
  violations: readonly PromptGroundingViolation[];
  citedEvidenceIds: readonly string[];
}>;

export const LOCAL_AI_PROMPT_GUARDRAILS = [
  {
    id: "cite-selection-evidence",
    severity: "error",
    instruction:
      "Every proposed UI change must cite selection or source evidence from the context packet.",
  },
  {
    id: "stay-inside-selection",
    severity: "error",
    instruction:
      "Only modify the current selection and explicitly allowed source paths. Do not infer broad project edits.",
  },
  {
    id: "respect-source-authority",
    severity: "error",
    instruction:
      "Treat stale, blocked, visual-only, or inspect-only evidence as insufficient for direct patching.",
  },
  {
    id: "avoid-autonomous-coding",
    severity: "error",
    instruction:
      "Do not perform opportunistic refactors, dependency changes, file creation sprees, or autonomous coding outside the requested UI edit.",
  },
  {
    id: "ask-when-ambiguous",
    severity: "warning",
    instruction:
      "When the evidence does not identify a safe edit target, return a question or a blocked result instead of guessing.",
  },
] as const satisfies readonly PromptGuardrail[];

export function evaluatePromptGrounding(packet: ContextPacket): PromptGroundingReport {
  const violations: PromptGroundingViolation[] = [];
  const citedEvidenceIds = new Set<string>();

  citedEvidenceIds.add(packet.selection.selectionId);
  packet.selection.evidenceIds.forEach((id) => citedEvidenceIds.add(id));
  packet.sourceEvidence.forEach((source) => citedEvidenceIds.add(source.evidenceId));
  packet.visualEvidence.forEach((visual) => citedEvidenceIds.add(visual.evidenceId));

  if (packet.selection.nodeIds.length === 0 && packet.constraints.selectionOnly) {
    violations.push({
      code: "stay-inside-selection",
      severity: "error",
      message: "Selection-only prompting requires at least one selected node.",
      evidenceIds: [packet.selection.selectionId],
    });
  }

  if (packet.constraints.requireEvidenceCitations && citedEvidenceIds.size === 0) {
    violations.push({
      code: "cite-selection-evidence",
      severity: "error",
      message: "No selection, source, or visual evidence is available for citation.",
      evidenceIds: [],
    });
  }

  if (
    packet.selection.authority === "blocked" ||
    packet.selection.authority === "stale" ||
    packet.selection.authority === "inspect_only" ||
    packet.selection.authority === "visual_only"
  ) {
    violations.push({
      code: "respect-source-authority",
      severity: "error",
      message: `Selection authority is ${packet.selection.authority}, so patch prompting must be blocked.`,
      evidenceIds: [packet.selection.selectionId],
    });
  }

  if (packet.constraints.allowBroadRefactors !== false || packet.constraints.maxFilesToTouch > 3) {
    violations.push({
      code: "avoid-autonomous-coding",
      severity: "error",
      message: "Prompt scope is too broad for the local UI edit pipeline.",
      evidenceIds: Array.from(citedEvidenceIds),
    });
  }

  const weakSources = packet.sourceEvidence.filter(isWeakSourceEvidence);
  if (weakSources.length > 0) {
    violations.push({
      code: "ask-when-ambiguous",
      severity: "warning",
      message: "Some source evidence is low-confidence or conflicting and should be treated as advisory.",
      evidenceIds: weakSources.map((source) => source.evidenceId),
    });
  }

  return {
    ok: violations.every((violation) => violation.severity !== "error"),
    violations,
    citedEvidenceIds: Array.from(citedEvidenceIds),
  };
}

export function renderGuardrailBlock(guardrails: readonly PromptGuardrail[] = LOCAL_AI_PROMPT_GUARDRAILS): string {
  return guardrails.map((guardrail) => `- ${guardrail.instruction}`).join("\n");
}

function isWeakSourceEvidence(source: ContextSourceEvidence): boolean {
  return (
    source.role === "conflicting" ||
    source.candidate.confidence.band === "low" ||
    source.candidate.confidence.band === "blocked"
  );
}
