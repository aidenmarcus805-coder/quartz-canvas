import {
  DOM_BRIDGE_PROTOCOL_VERSION,
  sanitizeBridgeEventEnvelope,
} from "./bridgeContracts";
import { sanitizeAttributeList, sanitizeTextHint } from "./sanitization";

export type PreviewContractValidationSummary = Readonly<{
  assertionCount: number;
  redactedText: string;
  sanitizedHref: string;
}>;

export function runPreviewContractValidation(): PreviewContractValidationSummary {
  let assertionCount = 0;
  const text = sanitizeTextHint("Contact jane@example.com token=abcdef1234567890", "fixture");
  assert(text.value.includes("[redacted]"), "text redaction should redact email and token");
  assertionCount += 1;

  const attributes = sanitizeAttributeList([
    { name: "href", value: "/account?email=jane@example.com#token" },
    { name: "onclick", value: "alert(secret)" },
    { name: "data-testid", value: "save-button" },
  ]);
  assert(attributes.attributes.href === "/account", "href should drop query and fragment");
  assert(attributes.attributes.onclick === undefined, "onclick should not be allowlisted");
  assertionCount += 2;

  const bridgeEvent = sanitizeBridgeEventEnvelope({
    protocol: DOM_BRIDGE_PROTOCOL_VERSION,
    type: "quartz.bridge.ready",
    eventId: "evt_1",
    emittedAt: "2026-04-25T00:00:00.000Z",
    projectId: "project_1",
    projectEpoch: "epoch_1",
    previewSessionId: "preview_1",
    bridgeSessionId: "bridge_1",
    pageNavigationId: "nav_1",
    routeFingerprint: "route_1",
    bridgeRevision: 1,
    payload: { capabilities: ["select"], bridgeBuildId: "bridge_build_1" },
  });
  assert(bridgeEvent.ok, "bridge event envelope should parse");
  assertionCount += 1;

  return {
    assertionCount,
    redactedText: text.value,
    sanitizedHref: attributes.attributes.href ?? "",
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
