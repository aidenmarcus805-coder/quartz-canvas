import type { SelectionId } from "../shared/types";
import type { BridgeCommand, DomBridgeEvent } from "./bridgeContracts";
import type { ElementReferencePayload } from "./elementReference";

export type PreviewMode = "interact" | "select" | "compare" | "paused";

export type PreviewControllerState = Readonly<{
  mode: PreviewMode;
  previewSessionId: string;
  bridgeSessionId?: string;
  pageNavigationId?: string;
  routeFingerprint?: string;
  loading: boolean;
  stale: boolean;
}>;

export type PreviewController = Readonly<{
  getState(): PreviewControllerState;
  setMode(mode: PreviewMode): void;
  reload(): void;
  dispose(): void;
}>;

export type SelectionOverlayState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "hovering"; element: ElementReferencePayload }>
  | Readonly<{ status: "selected"; selectionId: SelectionId; element: ElementReferencePayload }>
  | Readonly<{ status: "stale"; selectionId: SelectionId; element: ElementReferencePayload; reasons: readonly string[] }>
  | Readonly<{ status: "blocked"; message: string }>;

export type SelectionOverlayController = Readonly<{
  getState(): SelectionOverlayState;
  showHover(element: ElementReferencePayload): void;
  showSelection(selectionId: SelectionId, element: ElementReferencePayload): void;
  markStale(selectionId: SelectionId, element: ElementReferencePayload, reasons: readonly string[]): void;
  block(message: string): void;
  clear(): void;
  dispose(): void;
}>;

export type BridgeEventUnsubscribe = () => void;

export type PreviewBridgeClient = Readonly<{
  postCommand(command: BridgeCommand): void;
  subscribe(listener: (event: DomBridgeEvent) => void): BridgeEventUnsubscribe;
}>;
