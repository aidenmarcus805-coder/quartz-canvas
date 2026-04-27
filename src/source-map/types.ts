import type { CandidateId, ProjectEpoch, ProjectId, SourceCandidateResult } from "../shared/types";

export type SourceCandidateSignalKind =
  | "ast"
  | "component"
  | "history"
  | "instrumentation"
  | "route"
  | "sourcemap"
  | "style"
  | "text"
  | "visual";

export type SourceCandidateSignal = Readonly<{
  kind: SourceCandidateSignalKind;
  strength: number;
  reason: string;
  freshness: "fresh" | "stale" | "unknown";
}>;

export type SourceCandidateSafetyFlag =
  | "cross_origin_frame"
  | "dependency_path"
  | "generated_file"
  | "protected_path"
  | "redacted_context"
  | "stale_hash";

export type SourceCandidateSafety = Readonly<{
  flags: readonly SourceCandidateSafetyFlag[];
  reasons: readonly string[];
}>;

export type SourceCandidateInput = Readonly<{
  candidateId: CandidateId;
  path: string;
  range?: SourceCandidateResult["range"];
  fileHash: string;
  projectId?: ProjectId;
  projectEpoch?: ProjectEpoch;
  routeFingerprint?: string;
  componentName?: string;
  signals: readonly SourceCandidateSignal[];
  safety: SourceCandidateSafety;
}>;

export type SourceCandidateScoring = Readonly<{
  rawScore: number;
  safetyPenalty: number;
  freshnessPenalty: number;
  normalizedScore: number;
  blockingFlags: readonly SourceCandidateSafetyFlag[];
}>;

export type ScoredSourceCandidate = SourceCandidateResult &
  Readonly<{
    signals: readonly SourceCandidateSignal[];
    safety: SourceCandidateSafety;
    scoring: SourceCandidateScoring;
  }>;

export type RankedSourceCandidate = ScoredSourceCandidate &
  Readonly<{
    rank: number;
  }>;
