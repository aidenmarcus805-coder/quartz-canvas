import type {
  AbsoluteFilePath,
  FileHash,
  IsoDateTimeString,
  NonEmptyString,
  VersionedContract,
} from "./common";
import type {
  LocalAiJobId,
  PatchSetId,
  PreviewFrameId,
  ProjectId,
  RevisionId,
  SelectionId,
  SessionId,
  SourceFileId,
  SourceSnapshotId,
} from "./ids";
import type { SelectionAuthorityLevel } from "./preview";

export const PROJECT_SESSION_STATUS = {
  Empty: "empty",
  PreviewConnected: "preview_connected",
  SelectionActive: "selection_active",
  AiRunning: "ai_running",
  ReviewingPatch: "reviewing_patch",
} as const;

export type ProjectSessionStatus =
  (typeof PROJECT_SESSION_STATUS)[keyof typeof PROJECT_SESSION_STATUS];

export type ProjectRoot = {
  readonly kind: "local_directory";
  readonly path: AbsoluteFilePath;
  readonly displayName: NonEmptyString;
};

export type ProjectManifest = VersionedContract & {
  readonly id: ProjectId;
  readonly name: NonEmptyString;
  readonly root: ProjectRoot;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
  readonly activeSessionId: SessionId | null;
  readonly latestRevisionId: RevisionId | null;
};

export type ProjectSessionState =
  | { readonly kind: "empty" }
  | {
      readonly kind: "preview_connected";
      readonly previewFrameId: PreviewFrameId;
    }
  | {
      readonly kind: "selection_active";
      readonly previewFrameId: PreviewFrameId;
      readonly selectionId: SelectionId;
      readonly authority: SelectionAuthorityLevel;
    }
  | {
      readonly kind: "ai_running";
      readonly selectionId: SelectionId;
      readonly jobId: LocalAiJobId;
    }
  | {
      readonly kind: "reviewing_patch";
      readonly patchSetId: PatchSetId;
      readonly selectionId: SelectionId | null;
    };

export type ProjectSession = VersionedContract & {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly createdAt: IsoDateTimeString;
  readonly lastActiveAt: IsoDateTimeString;
  readonly currentRevisionId: RevisionId | null;
  readonly state: ProjectSessionState;
};

export type RevisionState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty"; readonly reason: NonEmptyString }
  | { readonly kind: "applied"; readonly patchSetId: PatchSetId }
  | { readonly kind: "rolled_back"; readonly rollbackId: import("./ids").RollbackId }
  | { readonly kind: "invalid"; readonly reason: NonEmptyString };

export type Revision = VersionedContract & {
  readonly id: RevisionId;
  readonly projectId: ProjectId;
  readonly parentRevisionId: RevisionId | null;
  readonly sourceSnapshotId: SourceSnapshotId;
  readonly createdAt: IsoDateTimeString;
  readonly label: NonEmptyString;
  readonly state: RevisionState;
};

export type SourceFileSnapshot = {
  readonly fileId: SourceFileId;
  readonly path: import("./common").RelativeFilePath;
  readonly hash: FileHash;
  readonly sizeBytes: number;
  readonly language: NonEmptyString | null;
  readonly lastModifiedAt: IsoDateTimeString;
};

export type SourceSnapshot = VersionedContract & {
  readonly id: SourceSnapshotId;
  readonly projectId: ProjectId;
  readonly revisionId: RevisionId | null;
  readonly createdAt: IsoDateTimeString;
  readonly files: readonly SourceFileSnapshot[];
};
