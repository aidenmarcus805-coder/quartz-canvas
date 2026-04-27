export type ProjectId = string;
export type ProjectEpoch = string;
export type SelectionId = string;
export type CandidateId = string;

export type SelectionAuthorityLevel =
  | "patch_authoritative"
  | "source_confirm_required"
  | "inspect_only"
  | "visual_only"
  | "stale"
  | "blocked";

export type AppError = {
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
};

export type SourceCandidateResult = {
  candidateId: CandidateId;
  path: string;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  fileHash: string;
  confidence: {
    score: number;
    band: "high" | "likely" | "ambiguous" | "low" | "blocked";
    reasons: string[];
  };
};
