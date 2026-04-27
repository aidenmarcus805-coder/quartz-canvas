import type { SourceCandidateResult } from "../shared/types";
import type {
  RankedSourceCandidate,
  ScoredSourceCandidate,
  SourceCandidateInput,
  SourceCandidateSafetyFlag,
  SourceCandidateSignalKind,
} from "./types";

const SIGNAL_WEIGHTS = {
  ast: 18,
  component: 18,
  history: 10,
  instrumentation: 34,
  route: 12,
  sourcemap: 26,
  style: 8,
  text: 6,
  visual: 4,
} satisfies Record<SourceCandidateSignalKind, number>;

const BAND_PRIORITY = {
  blocked: 0,
  low: 1,
  ambiguous: 2,
  likely: 3,
  high: 4,
} satisfies Record<SourceCandidateResult["confidence"]["band"], number>;

const BLOCKING_SAFETY_FLAGS = new Set<SourceCandidateSafetyFlag>([
  "cross_origin_frame",
  "dependency_path",
  "protected_path",
  "stale_hash",
]);

export function rankSourceCandidates(
  candidates: readonly SourceCandidateInput[],
): readonly RankedSourceCandidate[] {
  return candidates
    .map(scoreSourceCandidate)
    .sort(compareScoredCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function scoreSourceCandidate(candidate: SourceCandidateInput): ScoredSourceCandidate {
  const rawScore = candidate.signals.reduce(
    (total, signal) => total + SIGNAL_WEIGHTS[signal.kind] * clamp01(signal.strength),
    0,
  );
  const freshnessPenalty = candidate.signals.reduce(
    (total, signal) => total + freshnessPenaltyFor(signal.freshness),
    0,
  );
  const blockingFlags = candidate.safety.flags.filter(isBlockingSafetyFlag);
  const safetyPenalty = candidate.safety.flags.length * 5 + blockingFlags.length * 100;
  const normalizedScore = blockingFlags.length > 0
    ? 0
    : clampScore(rawScore - freshnessPenalty - safetyPenalty);

  return {
    candidateId: candidate.candidateId,
    path: normalizeCandidatePath(candidate.path),
    range: candidate.range,
    fileHash: candidate.fileHash,
    confidence: {
      score: normalizedScore,
      band: confidenceBand(normalizedScore, blockingFlags),
      reasons: buildConfidenceReasons(candidate, rawScore, freshnessPenalty, safetyPenalty),
    },
    signals: candidate.signals,
    safety: candidate.safety,
    scoring: {
      rawScore,
      safetyPenalty,
      freshnessPenalty,
      normalizedScore,
      blockingFlags,
    },
  };
}

export function compareScoredCandidates(
  left: ScoredSourceCandidate,
  right: ScoredSourceCandidate,
): number {
  return (
    BAND_PRIORITY[right.confidence.band] - BAND_PRIORITY[left.confidence.band] ||
    right.confidence.score - left.confidence.score ||
    left.scoring.blockingFlags.length - right.scoring.blockingFlags.length ||
    left.path.localeCompare(right.path) ||
    rangeStart(left) - rangeStart(right) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

export function confidenceBand(
  score: number,
  blockingFlags: readonly SourceCandidateSafetyFlag[],
): SourceCandidateResult["confidence"]["band"] {
  if (blockingFlags.length > 0) return "blocked";
  if (score >= 85) return "high";
  if (score >= 68) return "likely";
  if (score >= 45) return "ambiguous";
  if (score > 0) return "low";
  return "blocked";
}

function buildConfidenceReasons(
  candidate: SourceCandidateInput,
  rawScore: number,
  freshnessPenalty: number,
  safetyPenalty: number,
): string[] {
  const signalReasons = candidate.signals.map((signal) => `${signal.kind}:${signal.reason}`);
  const penaltyReasons = [
    freshnessPenalty > 0 ? `freshness_penalty:${freshnessPenalty}` : "",
    safetyPenalty > 0 ? `safety_penalty:${safetyPenalty}` : "",
    rawScore === 0 ? "no_positive_signals" : "",
  ].filter((reason) => reason.length > 0);

  return [...signalReasons, ...candidate.safety.reasons, ...penaltyReasons];
}

function normalizeCandidatePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function freshnessPenaltyFor(freshness: "fresh" | "stale" | "unknown"): number {
  if (freshness === "stale") return 18;
  if (freshness === "unknown") return 6;
  return 0;
}

function isBlockingSafetyFlag(flag: SourceCandidateSafetyFlag): boolean {
  return BLOCKING_SAFETY_FLAGS.has(flag);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function rangeStart(candidate: ScoredSourceCandidate): number {
  return candidate.range?.startLine ?? Number.MAX_SAFE_INTEGER;
}
