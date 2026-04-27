import type { ElementReferencePayload } from "../preview/elementReference";
import { rankSourceCandidates } from "../source-map/ranking";
import {
  createEmptySelectionState,
  createSelectionFreshnessSnapshot,
  createSelectionIdFromReference,
  transitionSelectionState,
  type SelectionState,
} from "./stateMachine";

export type SelectionValidationSummary = Readonly<{
  assertionCount: number;
  finalStatus: SelectionState["status"];
  finalRevision: number;
}>;

export function runSelectionStateMachineValidation(): SelectionValidationSummary {
  let assertionCount = 0;
  const element = elementReferenceFixture();
  const candidates = rankSourceCandidates([
    {
      candidateId: "candidate_1",
      path: "src/components/Hero.tsx",
      fileHash: "hash_1",
      signals: [
        { kind: "instrumentation", strength: 1, reason: "data source id", freshness: "fresh" },
        { kind: "sourcemap", strength: 1, reason: "source map", freshness: "fresh" },
        { kind: "component", strength: 1, reason: "component", freshness: "fresh" },
      ],
      safety: { flags: [], reasons: [] },
    },
  ]);

  const empty = createEmptySelectionState("2026-04-25T00:00:00.000Z");
  const committed = transitionSelectionState(empty, {
    type: "selection.committed",
    selectionId: createSelectionIdFromReference(element),
    element,
    candidates,
    freshness: createSelectionFreshnessSnapshot(element, "source_index_1", candidates),
    at: "2026-04-25T00:00:01.000Z",
  });
  assert(committed.status === "committed", "selection should commit");
  assertionCount += 1;

  const stale = transitionSelectionState(committed, {
    type: "selection.contextRevalidated",
    context: {
      ...element,
      bridgeRevision: 2,
      sourceIndexRevision: "source_index_1",
      fileHashes: { "src/components/Hero.tsx": "hash_1" },
    },
    at: "2026-04-25T00:00:02.000Z",
  });
  assert(stale.status === "stale", "bridge revision advance should stale selection");
  assert(stale.revision === 2, "revision should advance deterministically");
  assertionCount += 2;

  return { assertionCount, finalStatus: stale.status, finalRevision: stale.revision };
}

function elementReferenceFixture(): ElementReferencePayload {
  return {
    referenceKind: "dom_element",
    elementReferenceId: "el_fixture",
    projectId: "project_1",
    projectEpoch: "epoch_1",
    previewSessionId: "preview_1",
    bridgeSessionId: "bridge_1",
    pageNavigationId: "nav_1",
    routeFingerprint: "route_1",
    bridgeRevision: 1,
    capturedAt: "2026-04-25T00:00:00.000Z",
    stableSelector: 'button[data-testid="hero-cta"]',
    selectorReliability: "instrumented",
    domPath: [
      {
        tagName: "button",
        childIndex: 1,
        sameTagIndex: 1,
        selectorSegment: 'button[data-testid="hero-cta"]',
        role: "button",
        testId: "hero-cta",
      },
    ],
    roleHints: {
      role: "button",
      accessibleName: "Start",
      text: "Start",
      labelText: "",
    },
    boundingBox: {
      x: 10,
      y: 20,
      width: 120,
      height: 32,
      top: 20,
      right: 130,
      bottom: 52,
      left: 10,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 1280,
      viewportHeight: 720,
    },
    attributes: { "data-testid": "hero-cta" },
    redactions: [],
    visibility: { visible: true, reasons: [] },
    frame: { sameOrigin: true, framePath: [] },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
