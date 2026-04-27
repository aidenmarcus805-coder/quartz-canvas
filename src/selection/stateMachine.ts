import type {
  CandidateId,
  SelectionAuthorityLevel,
  SelectionId,
  SourceCandidateResult,
} from "../shared/types";
import type { BridgeIdentitySnapshot, ElementReferencePayload } from "../preview/elementReference";
import type { RankedSourceCandidate } from "../source-map/types";

export type SelectionStaleReasonKind =
  | "bridge_revision_advanced"
  | "bridge_revision_mismatch"
  | "bridge_session_changed"
  | "candidate_removed"
  | "file_hash_mismatch"
  | "manual_invalidation"
  | "page_navigation_changed"
  | "preview_session_changed"
  | "project_epoch_changed"
  | "route_changed"
  | "source_index_changed";

export type SelectionStaleReason = Readonly<{
  kind: SelectionStaleReasonKind;
  expected?: string | number;
  actual?: string | number;
  path?: string;
}>;

export type SelectionFreshnessSnapshot = BridgeIdentitySnapshot &
  Readonly<{
    sourceIndexRevision: string;
    candidateFileHashes: Readonly<Record<string, string>>;
  }>;

export type SelectionFreshnessContext = BridgeIdentitySnapshot &
  Readonly<{
    sourceIndexRevision: string;
    fileHashes: Readonly<Record<string, string>>;
  }>;

export type EmptySelectionState = Readonly<{
  status: "empty";
  revision: number;
  updatedAt: string;
}>;

export type HoverSelectionState = Readonly<{
  status: "hovering";
  revision: number;
  updatedAt: string;
  element: ElementReferencePayload;
}>;

export type CommittedSelectionState = Readonly<{
  status: "committed";
  revision: number;
  updatedAt: string;
  selectionId: SelectionId;
  element: ElementReferencePayload;
  candidates: readonly RankedSourceCandidate[];
  selectedCandidateId?: CandidateId;
  authority: SelectionAuthorityLevel;
  freshness: SelectionFreshnessSnapshot;
  staleReasons: readonly [];
}>;

export type StaleSelectionState = Readonly<{
  status: "stale";
  revision: number;
  updatedAt: string;
  previous: CommittedSelectionState;
  authority: "stale";
  staleReasons: readonly SelectionStaleReason[];
}>;

export type BlockedSelectionState = Readonly<{
  status: "blocked";
  revision: number;
  updatedAt: string;
  authority: "blocked";
  reason: string;
  element?: ElementReferencePayload;
}>;

export type SelectionState =
  | EmptySelectionState
  | HoverSelectionState
  | CommittedSelectionState
  | StaleSelectionState
  | BlockedSelectionState;

export type SelectionEvent =
  | Readonly<{ type: "selection.hovered"; element: ElementReferencePayload; at: string }>
  | Readonly<{
      type: "selection.committed";
      selectionId: SelectionId;
      element: ElementReferencePayload;
      candidates: readonly RankedSourceCandidate[];
      selectedCandidateId?: CandidateId;
      freshness: SelectionFreshnessSnapshot;
      at: string;
    }>
  | Readonly<{ type: "selection.candidateChosen"; candidateId: CandidateId; at: string }>
  | Readonly<{ type: "selection.contextRevalidated"; context: SelectionFreshnessContext; at: string }>
  | Readonly<{ type: "selection.markStale"; reasons: readonly SelectionStaleReason[]; at: string }>
  | Readonly<{ type: "selection.sourceCandidatesRanked"; candidates: readonly RankedSourceCandidate[]; at: string }>
  | Readonly<{ type: "selection.blocked"; reason: string; element?: ElementReferencePayload; at: string }>
  | Readonly<{ type: "selection.cleared"; at: string }>;

export function createEmptySelectionState(at: string): EmptySelectionState {
  return { status: "empty", revision: 0, updatedAt: at };
}

export function transitionSelectionState(
  state: SelectionState,
  event: SelectionEvent,
): SelectionState {
  switch (event.type) {
    case "selection.hovered":
      return { status: "hovering", revision: state.revision + 1, updatedAt: event.at, element: event.element };
    case "selection.committed":
      return commitSelection(state, event);
    case "selection.candidateChosen":
      return chooseCandidate(state, event);
    case "selection.contextRevalidated":
      return revalidateSelection(state, event);
    case "selection.markStale":
      return markSelectionStale(state, event.reasons, event.at);
    case "selection.sourceCandidatesRanked":
      return updateCandidates(state, event.candidates, event.at);
    case "selection.blocked":
      return {
        status: "blocked",
        revision: state.revision + 1,
        updatedAt: event.at,
        authority: "blocked",
        reason: event.reason,
        element: event.element,
      };
    case "selection.cleared":
      return { status: "empty", revision: state.revision + 1, updatedAt: event.at };
  }
}

export function evaluateSelectionStaleness(
  selection: CommittedSelectionState,
  context: SelectionFreshnessContext,
): readonly SelectionStaleReason[] {
  return [
    compareString("project_epoch_changed", selection.freshness.projectEpoch, context.projectEpoch),
    compareString("preview_session_changed", selection.freshness.previewSessionId, context.previewSessionId),
    compareString("bridge_session_changed", selection.freshness.bridgeSessionId, context.bridgeSessionId),
    compareString("page_navigation_changed", selection.freshness.pageNavigationId, context.pageNavigationId),
    compareString("route_changed", selection.freshness.routeFingerprint, context.routeFingerprint),
    compareString("source_index_changed", selection.freshness.sourceIndexRevision, context.sourceIndexRevision),
    compareBridgeRevision(selection.freshness.bridgeRevision, context.bridgeRevision),
    ...compareFileHashes(selection.freshness.candidateFileHashes, context.fileHashes),
  ].filter((reason): reason is SelectionStaleReason => reason !== undefined);
}

export function deriveSelectionAuthority(
  candidates: readonly SourceCandidateResult[],
  selectedCandidateId?: CandidateId,
): SelectionAuthorityLevel {
  if (candidates.length === 0) return "inspect_only";

  const sorted = [...candidates].sort(compareCandidateResults);
  const selected = selectedCandidateId
    ? sorted.find((candidate) => candidate.candidateId === selectedCandidateId)
    : sorted[0];
  if (!selected || selected.confidence.band === "blocked" || selected.confidence.band === "low") {
    return "inspect_only";
  }

  const second = sorted.find((candidate) => candidate.candidateId !== selected.candidateId);
  if (selected.confidence.band === "high" && isCandidateUniquelyAhead(selected, second)) {
    return "patch_authoritative";
  }

  return "source_confirm_required";
}

export function createSelectionFreshnessSnapshot(
  identity: BridgeIdentitySnapshot,
  sourceIndexRevision: string,
  candidates: readonly SourceCandidateResult[],
): SelectionFreshnessSnapshot {
  return {
    ...identity,
    sourceIndexRevision,
    candidateFileHashes: Object.fromEntries(
      candidates.map((candidate) => [candidate.path, candidate.fileHash]),
    ),
  };
}

export function createSelectionIdFromReference(element: ElementReferencePayload): SelectionId {
  return `sel_${element.elementReferenceId}_${element.bridgeRevision}`;
}

function commitSelection(
  state: SelectionState,
  event: Extract<SelectionEvent, { type: "selection.committed" }>,
): CommittedSelectionState {
  return {
    status: "committed",
    revision: state.revision + 1,
    updatedAt: event.at,
    selectionId: event.selectionId,
    element: event.element,
    candidates: event.candidates,
    selectedCandidateId: event.selectedCandidateId,
    authority: deriveSelectionAuthority(event.candidates, event.selectedCandidateId),
    freshness: event.freshness,
    staleReasons: [],
  };
}

function chooseCandidate(
  state: SelectionState,
  event: Extract<SelectionEvent, { type: "selection.candidateChosen" }>,
): SelectionState {
  if (state.status !== "committed") return state;
  return {
    ...state,
    revision: state.revision + 1,
    updatedAt: event.at,
    selectedCandidateId: event.candidateId,
    authority: deriveSelectionAuthority(state.candidates, event.candidateId),
  };
}

function revalidateSelection(
  state: SelectionState,
  event: Extract<SelectionEvent, { type: "selection.contextRevalidated" }>,
): SelectionState {
  const committed = state.status === "committed" ? state : state.status === "stale" ? state.previous : undefined;
  if (!committed) return state;

  const staleReasons = evaluateSelectionStaleness(committed, event.context);
  if (staleReasons.length > 0) {
    return markCommittedStale(committed, staleReasons, event.at);
  }

  return {
    ...committed,
    revision: state.revision + 1,
    updatedAt: event.at,
    freshness: {
      ...committed.freshness,
      ...event.context,
      candidateFileHashes: committed.freshness.candidateFileHashes,
    },
    authority: deriveSelectionAuthority(committed.candidates, committed.selectedCandidateId),
  };
}

function markSelectionStale(
  state: SelectionState,
  reasons: readonly SelectionStaleReason[],
  at: string,
): SelectionState {
  if (state.status === "committed") {
    return markCommittedStale(state, reasons, at);
  }
  if (state.status === "stale") {
    return { ...state, revision: state.revision + 1, updatedAt: at, staleReasons: reasons };
  }
  return state;
}

function updateCandidates(
  state: SelectionState,
  candidates: readonly RankedSourceCandidate[],
  at: string,
): SelectionState {
  if (state.status !== "committed") return state;
  return {
    ...state,
    revision: state.revision + 1,
    updatedAt: at,
    candidates,
    authority: deriveSelectionAuthority(candidates, state.selectedCandidateId),
  };
}

function markCommittedStale(
  state: CommittedSelectionState,
  reasons: readonly SelectionStaleReason[],
  at: string,
): StaleSelectionState {
  return {
    status: "stale",
    revision: state.revision + 1,
    updatedAt: at,
    previous: state,
    authority: "stale",
    staleReasons: reasons.length > 0 ? reasons : [{ kind: "manual_invalidation" }],
  };
}

function compareString(
  kind: SelectionStaleReasonKind,
  expected: string,
  actual: string,
): SelectionStaleReason | undefined {
  return expected === actual ? undefined : { kind, expected, actual };
}

function compareBridgeRevision(
  expected: number,
  actual: number,
): SelectionStaleReason | undefined {
  if (actual > expected) {
    return { kind: "bridge_revision_advanced", expected, actual };
  }
  if (actual < expected) {
    return { kind: "bridge_revision_mismatch", expected, actual };
  }
  return undefined;
}

function compareFileHashes(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): readonly SelectionStaleReason[] {
  return Object.entries(expected)
    .filter(([path, fileHash]) => actual[path] !== undefined && actual[path] !== fileHash)
    .map(([path, fileHash]) => ({
      kind: "file_hash_mismatch",
      path,
      expected: fileHash,
      actual: actual[path],
    }));
}

function compareCandidateResults(left: SourceCandidateResult, right: SourceCandidateResult): number {
  return (
    right.confidence.score - left.confidence.score ||
    left.path.localeCompare(right.path) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function isCandidateUniquelyAhead(
  selected: SourceCandidateResult,
  second: SourceCandidateResult | undefined,
): boolean {
  return !second || selected.confidence.score - second.confidence.score >= 12;
}
