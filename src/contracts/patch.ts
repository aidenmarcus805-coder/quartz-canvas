import type {
  FileHash,
  IsoDateTimeString,
  NonEmptyString,
  RelativeFilePath,
  VersionedContract,
} from "./common";
import type {
  AiRequestId,
  LocalAiJobId,
  PatchSetId,
  ProposalId,
  ProjectId,
  RevisionId,
  RollbackId,
  SelectionId,
  SourceFileId,
  ValidationRunId,
} from "./ids";
import type { SourceRange } from "./preview";

export type DiffLine =
  | { readonly kind: "context"; readonly oldLine: number; readonly newLine: number; readonly text: string }
  | { readonly kind: "added"; readonly newLine: number; readonly text: string }
  | { readonly kind: "removed"; readonly oldLine: number; readonly text: string };

export type DiffHunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: readonly DiffLine[];
};

export type PatchOperation =
  | {
      readonly kind: "insert";
      readonly at: SourceRange;
      readonly newText: string;
    }
  | {
      readonly kind: "replace";
      readonly range: SourceRange;
      readonly oldText: string;
      readonly newText: string;
    }
  | {
      readonly kind: "delete";
      readonly range: SourceRange;
      readonly oldText: string;
    };

export type FilePatch = {
  readonly sourceFileId: SourceFileId;
  readonly path: RelativeFilePath;
  readonly beforeHash: FileHash;
  readonly afterHash: FileHash | null;
  readonly operations: readonly PatchOperation[];
  readonly hunks: readonly DiffHunk[];
};

export type PatchFileChange =
  | {
      readonly operation: "create";
      readonly path: RelativeFilePath;
      readonly content: string;
    }
  | {
      readonly operation: "modify";
      readonly path: RelativeFilePath;
      readonly old_hash: FileHash;
      readonly unified_diff: NonEmptyString;
    }
  | {
      readonly operation: "delete";
      readonly path: RelativeFilePath;
      readonly old_hash: FileHash;
    }
  | {
      readonly operation: "rename";
      readonly from: RelativeFilePath;
      readonly to: RelativeFilePath;
      readonly old_hash: FileHash;
    };

export type PatchProposal = {
  readonly proposalId: ProposalId;
  readonly projectId: ProjectId;
  readonly requestId: AiRequestId;
  readonly summary: NonEmptyString;
  readonly files: readonly PatchFileChange[];
};

export type PatchSet = VersionedContract & {
  readonly id: PatchSetId;
  readonly projectId: ProjectId;
  readonly baseRevisionId: RevisionId;
  readonly targetRevisionId: RevisionId | null;
  readonly selectionId: SelectionId | null;
  readonly aiJobId: LocalAiJobId | null;
  readonly createdAt: IsoDateTimeString;
  readonly summary: NonEmptyString;
  readonly files: readonly FilePatch[];
};

export type PatchValidationCheck =
  | {
      readonly kind: "source_hash";
      readonly status: "passed" | "failed";
      readonly path: RelativeFilePath;
      readonly expectedHash: FileHash;
      readonly actualHash: FileHash | null;
    }
  | {
      readonly kind: "source_range";
      readonly status: "passed" | "failed";
      readonly path: RelativeFilePath;
      readonly range: SourceRange;
      readonly reason?: NonEmptyString;
    }
  | {
      readonly kind: "shell_constraint";
      readonly status: "passed" | "failed";
      readonly reason: NonEmptyString;
    }
  | {
      readonly kind: "typecheck";
      readonly status: "not_run" | "passed" | "failed";
      readonly command: NonEmptyString;
      readonly output?: string;
    };

export type PatchValidationReport = VersionedContract & {
  readonly id: ValidationRunId;
  readonly patchSetId: PatchSetId;
  readonly projectId: ProjectId;
  readonly status: "not_run" | "passed" | "failed" | "blocked";
  readonly checks: readonly PatchValidationCheck[];
  readonly createdAt: IsoDateTimeString;
};

export type RollbackSnapshotFile = {
  readonly sourceFileId: SourceFileId;
  readonly path: RelativeFilePath;
  readonly hash: FileHash;
  readonly content: string;
};

export type RollbackSnapshot = VersionedContract & {
  readonly id: RollbackId;
  readonly projectId: ProjectId;
  readonly revisionId: RevisionId;
  readonly patchSetId: PatchSetId;
  readonly createdAt: IsoDateTimeString;
  readonly files: readonly RollbackSnapshotFile[];
};

export type RollbackPlanState =
  | { readonly kind: "ready" }
  | { readonly kind: "applied"; readonly appliedAt: IsoDateTimeString }
  | { readonly kind: "failed"; readonly failedAt: IsoDateTimeString; readonly reason: NonEmptyString };

export type RollbackPlan = VersionedContract & {
  readonly id: RollbackId;
  readonly projectId: ProjectId;
  readonly snapshotId: RollbackId;
  readonly patchSetId: PatchSetId;
  readonly state: RollbackPlanState;
  readonly createdAt: IsoDateTimeString;
};
