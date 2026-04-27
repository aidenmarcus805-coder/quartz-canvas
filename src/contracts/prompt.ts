import type {
  IsoDateTimeString,
  NonEmptyString,
  VersionedContract,
} from "./common";
import type {
  ProjectId,
  PromptId,
  RevisionId,
  SelectionId,
  SessionId,
  UiSkillId,
} from "./ids";

export type PromptRole = "system" | "developer" | "user" | "assistant";

export type PromptMessage = {
  readonly role: PromptRole;
  readonly content: NonEmptyString;
  readonly scope: "global" | "project" | "selection" | "patch_review";
};

export type ChangeIntent =
  | { readonly kind: "restyle"; readonly target: NonEmptyString }
  | { readonly kind: "copy_change"; readonly target: NonEmptyString }
  | { readonly kind: "layout_adjustment"; readonly target: NonEmptyString }
  | { readonly kind: "accessibility_fix"; readonly target: NonEmptyString }
  | { readonly kind: "implementation_request"; readonly target: NonEmptyString };

export type PromptConstraint = {
  readonly kind:
    | "preserve_visible_shell"
    | "no_ui_expansion"
    | "source_grounded_only"
    | "local_only"
    | "user_confirm_required";
  readonly required: boolean;
};

export type PromptContract = VersionedContract & {
  readonly id: PromptId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly revisionId: RevisionId;
  readonly selectionId: SelectionId | null;
  readonly intent: ChangeIntent;
  readonly messages: readonly PromptMessage[];
  readonly constraints: readonly PromptConstraint[];
  readonly uiSkillIds: readonly UiSkillId[];
  readonly createdAt: IsoDateTimeString;
};

export type UiSkillInstruction = {
  readonly kind: "constraint" | "workflow" | "preference";
  readonly text: NonEmptyString;
  readonly required: boolean;
};

export type UiSkill = VersionedContract & {
  readonly id: UiSkillId;
  readonly name: NonEmptyString;
  readonly version: NonEmptyString;
  readonly appliesTo:
    | "desktop_shell"
    | "selection_workflow"
    | "patch_review"
    | "source_grounding";
  readonly riskLevel: "low" | "medium" | "high";
  readonly instructions: readonly UiSkillInstruction[];
};
