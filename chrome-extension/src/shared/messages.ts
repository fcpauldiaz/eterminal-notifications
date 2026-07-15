import type { FlowUiState } from "./types";

export type ExtensionMessage =
  | { type: "FLOW_UPDATE"; state: FlowUiState }
  | { type: "GET_FLOW_UI" }
  | { type: "FLOW_UI"; state: FlowUiState | null }
  | { type: "POLL_NOW" }
  | { type: "TEST_NOTIFY" }
  | { type: "GET_STATUS" }
  | {
      type: "STATUS";
      enabled: boolean;
      authOk: boolean;
      hasNtfyTopic: boolean;
      withinWindow: boolean;
    }
  | {
      type: "TEST_NOTIFY_RESULT";
      ok: boolean;
      ntfySkipped: boolean;
      ntfyStatus?: number;
      ntfyBody?: string;
      error?: string;
    };
