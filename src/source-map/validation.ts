import { rankSourceCandidates } from "./ranking";
import type { SourceCandidateInput } from "./types";

export type SourceMapRankingValidationSummary = Readonly<{
  assertionCount: number;
  rankedCandidateIds: readonly string[];
}>;

export function runSourceMapRankingValidation(): SourceMapRankingValidationSummary {
  let assertionCount = 0;
  const ranked = rankSourceCandidates([highConfidenceCandidate(), blockedCandidate(), ambiguousCandidate()]);

  assert(ranked[0]?.candidateId === "candidate_high", "instrumented fresh candidate should rank first");
  assert(ranked[1]?.candidateId === "candidate_ambiguous", "ambiguous candidate should rank above blocked");
  assert(ranked[2]?.confidence.band === "blocked", "protected path candidate should be blocked");
  assertionCount += 3;

  return {
    assertionCount,
    rankedCandidateIds: ranked.map((candidate) => candidate.candidateId),
  };
}

function highConfidenceCandidate(): SourceCandidateInput {
  return {
    candidateId: "candidate_high",
    path: "src/components/SaveButton.tsx",
    range: { startLine: 12, startColumn: 3, endLine: 19, endColumn: 8 },
    fileHash: "hash_a",
    signals: [
      { kind: "instrumentation", strength: 1, reason: "data-source-id", freshness: "fresh" },
      { kind: "sourcemap", strength: 1, reason: "mapped range", freshness: "fresh" },
      { kind: "component", strength: 0.9, reason: "component name", freshness: "fresh" },
      { kind: "route", strength: 0.8, reason: "route owner", freshness: "fresh" },
    ],
    safety: { flags: [], reasons: [] },
  };
}

function ambiguousCandidate(): SourceCandidateInput {
  return {
    candidateId: "candidate_ambiguous",
    path: "src/components/Button.tsx",
    fileHash: "hash_b",
    signals: [
      { kind: "ast", strength: 0.8, reason: "matching JSX", freshness: "fresh" },
      { kind: "text", strength: 0.7, reason: "text hint", freshness: "unknown" },
    ],
    safety: { flags: [], reasons: [] },
  };
}

function blockedCandidate(): SourceCandidateInput {
  return {
    candidateId: "candidate_blocked",
    path: "node_modules/pkg/Button.js",
    fileHash: "hash_c",
    signals: [{ kind: "text", strength: 1, reason: "text hint", freshness: "fresh" }],
    safety: { flags: ["dependency_path"], reasons: ["dependency path is not patchable"] },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
