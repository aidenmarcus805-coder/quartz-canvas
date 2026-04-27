import {
  BOUNDARY_SOURCE,
  type BoundarySource,
  type ChangeIntent,
  type PromptConstraint,
  type PromptContract,
  type PromptMessage,
  type UiSkill,
  type UiSkillInstruction,
} from "../contracts";
import {
  parseProjectId,
  parsePromptId,
  parseRevisionId,
  parseSelectionId,
  parseSessionId,
  parseUiSkillId,
} from "./ids";
import { parseIsoDateTimeString, parseNonEmptyString } from "./primitives";
import {
  fieldOk,
  fromFieldResult,
  parseContractVersion,
  readLiteralField,
  readNullableParsedField,
  readParsedArrayField,
  readParsedField,
  readRecord,
  readBooleanField,
  rejectUnknownFields,
  type FieldResult,
  type ValidationResult,
} from "./validation";

const PROMPT_ROLES = ["system", "developer", "user", "assistant"] as const;
const PROMPT_SCOPES = ["global", "project", "selection", "patch_review"] as const;
const PROMPT_CONSTRAINTS = [
  "preserve_visible_shell",
  "no_ui_expansion",
  "source_grounded_only",
  "local_only",
  "user_confirm_required",
] as const;

function parsePromptMessage(value: unknown, path: string): FieldResult<PromptMessage> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["role", "content", "scope"], path);
  if (!unknownResult.ok) return unknownResult;

  const role = readLiteralField(record, "role", PROMPT_ROLES, `${path}.role`);
  if (!role.ok) return role;
  const content = readParsedField(record, "content", `${path}.content`, parseNonEmptyString);
  if (!content.ok) return content;
  const scope = readLiteralField(record, "scope", PROMPT_SCOPES, `${path}.scope`);
  if (!scope.ok) return scope;

  return fieldOk({ role: role.value, content: content.value, scope: scope.value });
}

function parseChangeIntent(value: unknown, path: string): FieldResult<ChangeIntent> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    [
      "restyle",
      "copy_change",
      "layout_adjustment",
      "accessibility_fix",
      "implementation_request",
    ] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;
  const unknownResult = rejectUnknownFields(record, ["kind", "target"], path);
  if (!unknownResult.ok) return unknownResult;
  const target = readParsedField(record, "target", `${path}.target`, parseNonEmptyString);
  if (!target.ok) return target;

  return fieldOk({ kind: kind.value, target: target.value });
}

function parsePromptConstraint(value: unknown, path: string): FieldResult<PromptConstraint> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["kind", "required"], path);
  if (!unknownResult.ok) return unknownResult;

  const kind = readLiteralField(record, "kind", PROMPT_CONSTRAINTS, `${path}.kind`);
  if (!kind.ok) return kind;
  const required = readBooleanField(record, "required", `${path}.required`);
  if (!required.ok) return required;

  return fieldOk({ kind: kind.value, required: required.value });
}

export function parsePromptContract(
  value: unknown,
  path: string,
): FieldResult<PromptContract> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "sessionId",
      "revisionId",
      "selectionId",
      "intent",
      "messages",
      "constraints",
      "uiSkillIds",
      "createdAt",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parsePromptId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const revisionId = readParsedField(record, "revisionId", `${path}.revisionId`, parseRevisionId);
  if (!revisionId.ok) return revisionId;
  const selectionId = readNullableParsedField(
    record,
    "selectionId",
    `${path}.selectionId`,
    parseSelectionId,
  );
  if (!selectionId.ok) return selectionId;
  const intent = readParsedField(record, "intent", `${path}.intent`, parseChangeIntent);
  if (!intent.ok) return intent;
  const messages = readParsedArrayField(
    record,
    "messages",
    `${path}.messages`,
    parsePromptMessage,
  );
  if (!messages.ok) return messages;
  const constraints = readParsedArrayField(
    record,
    "constraints",
    `${path}.constraints`,
    parsePromptConstraint,
  );
  if (!constraints.ok) return constraints;
  const uiSkillIds = readParsedArrayField(
    record,
    "uiSkillIds",
    `${path}.uiSkillIds`,
    parseUiSkillId,
  );
  if (!uiSkillIds.ok) return uiSkillIds;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    revisionId: revisionId.value,
    selectionId: selectionId.value,
    intent: intent.value,
    messages: messages.value,
    constraints: constraints.value,
    uiSkillIds: uiSkillIds.value,
    createdAt: createdAt.value,
  });
}

function parseUiSkillInstruction(
  value: unknown,
  path: string,
): FieldResult<UiSkillInstruction> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["kind", "text", "required"], path);
  if (!unknownResult.ok) return unknownResult;

  const kind = readLiteralField(
    record,
    "kind",
    ["constraint", "workflow", "preference"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;
  const text = readParsedField(record, "text", `${path}.text`, parseNonEmptyString);
  if (!text.ok) return text;
  const required = readBooleanField(record, "required", `${path}.required`);
  if (!required.ok) return required;

  return fieldOk({ kind: kind.value, text: text.value, required: required.value });
}

export function parseUiSkill(value: unknown, path: string): FieldResult<UiSkill> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "name",
      "version",
      "appliesTo",
      "riskLevel",
      "instructions",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parseUiSkillId);
  if (!id.ok) return id;
  const name = readParsedField(record, "name", `${path}.name`, parseNonEmptyString);
  if (!name.ok) return name;
  const version = readParsedField(record, "version", `${path}.version`, parseNonEmptyString);
  if (!version.ok) return version;
  const appliesTo = readLiteralField(
    record,
    "appliesTo",
    ["desktop_shell", "selection_workflow", "patch_review", "source_grounding"] as const,
    `${path}.appliesTo`,
  );
  if (!appliesTo.ok) return appliesTo;
  const riskLevel = readLiteralField(
    record,
    "riskLevel",
    ["low", "medium", "high"] as const,
    `${path}.riskLevel`,
  );
  if (!riskLevel.ok) return riskLevel;
  const instructions = readParsedArrayField(
    record,
    "instructions",
    `${path}.instructions`,
    parseUiSkillInstruction,
  );
  if (!instructions.ok) return instructions;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    name: name.value,
    version: version.value,
    appliesTo: appliesTo.value,
    riskLevel: riskLevel.value,
    instructions: instructions.value,
  });
}

export function parsePromptContractPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<PromptContract> {
  return fromFieldResult(source, parsePromptContract(value, "$"));
}

export function parseUiSkillPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<UiSkill> {
  return fromFieldResult(source, parseUiSkill(value, "$"));
}
