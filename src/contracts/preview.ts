import type {
  FileHash,
  IsoDateTimeString,
  JsonObject,
  NonEmptyString,
  RelativeFilePath,
  VersionedContract,
} from "./common";
import type {
  CandidateId,
  DomNodePath,
  PreviewFrameId,
  ProjectId,
  SelectionId,
  SessionId,
  SourceFileId,
} from "./ids";

export type SelectionAuthorityLevel =
  | "patch_authoritative"
  | "source_confirm_required"
  | "inspect_only"
  | "visual_only"
  | "stale"
  | "blocked";

export type SourcePosition = {
  readonly line: number;
  readonly column: number;
};

export type SourceRange = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

export type DomRectSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ViewportSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly devicePixelRatio: number;
};

export type SelectionAuthority = {
  readonly level: SelectionAuthorityLevel;
  readonly reasons: readonly NonEmptyString[];
  readonly decidedAt: IsoDateTimeString;
};

export type SourceCandidateConfidence = {
  readonly score: number;
  readonly band: "high" | "likely" | "ambiguous" | "low" | "blocked";
  readonly reasons: readonly NonEmptyString[];
};

export type SourceCandidateResult = {
  readonly candidateId: CandidateId;
  readonly path: RelativeFilePath;
  readonly range?: SourceRange;
  readonly fileHash: FileHash;
  readonly confidence: SourceCandidateConfidence;
};

export type SelectedElementSnapshot = {
  readonly nodePath: DomNodePath;
  readonly tagName: NonEmptyString;
  readonly selector: NonEmptyString | null;
  readonly rect: DomRectSnapshot;
  readonly attributes: JsonObject;
  readonly textContent: string;
  readonly outerHtml: string;
};

export type VisibleSelection = VersionedContract & {
  readonly id: SelectionId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly previewFrameId: PreviewFrameId;
  readonly capturedAt: IsoDateTimeString;
  readonly viewport: ViewportSnapshot;
  readonly element: SelectedElementSnapshot;
  readonly authority: SelectionAuthority;
  readonly sourceCandidates: readonly SourceCandidateResult[];
};

export type PreviewFrame = VersionedContract & {
  readonly id: PreviewFrameId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly url: NonEmptyString;
  readonly connectedAt: IsoDateTimeString;
  readonly lastNavigatedAt: IsoDateTimeString | null;
};

export type SourceMapEntry = {
  readonly sourceFileId: SourceFileId;
  readonly generatedPath: DomNodePath;
  readonly generatedRange: SourceRange | null;
  readonly sourceRange: SourceRange;
  readonly confidence: SourceCandidateConfidence;
};

export type SourceMapSnapshot = VersionedContract & {
  readonly projectId: ProjectId;
  readonly previewFrameId: PreviewFrameId;
  readonly generatedAt: IsoDateTimeString;
  readonly entries: readonly SourceMapEntry[];
};

export type PreviewBridgeEvent =
  | {
      readonly kind: "preview_connected";
      readonly frame: PreviewFrame;
    }
  | {
      readonly kind: "selection_changed";
      readonly selection: VisibleSelection;
    }
  | {
      readonly kind: "source_candidates_resolved";
      readonly selectionId: SelectionId;
      readonly candidates: readonly SourceCandidateResult[];
      readonly authority: SelectionAuthority;
    }
  | {
      readonly kind: "preview_disconnected";
      readonly previewFrameId: PreviewFrameId;
      readonly reason: NonEmptyString;
      readonly disconnectedAt: IsoDateTimeString;
    };
