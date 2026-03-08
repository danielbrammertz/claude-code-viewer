import type { AcpxNdjsonEvent } from "../models/AcpxEvent";

export type AcpxAction =
  | { type: "session_initialized"; sessionId: string }
  | { type: "assistant_content_received"; sessionId: string }
  | { type: "turn_completed"; sessionId: string }
  | { type: "error"; message: string; sessionId: string | undefined }
  | { type: "ignored" };

/**
 * Pure function mapping a parsed acpx NDJSON event to a state machine action.
 *
 * Tracking flags (`hasSessionId`, `hasReceivedAssistantContent`) are managed by
 * the caller so this function stays pure.
 */
export const mapAcpxEventToAction = (
  event: AcpxNdjsonEvent,
  context: {
    hasSessionId: boolean;
    hasReceivedAssistantContent: boolean;
  },
): AcpxAction => {
  // session/update notification
  if ("method" in event && event.method === "session/update") {
    const sessionId = event.params.sessionId;

    // First notification carrying a sessionId triggers initialization
    if (!context.hasSessionId && sessionId) {
      return { type: "session_initialized", sessionId };
    }

    // First agent_message_chunk means assistant content has arrived (file_created equivalent)
    if (
      event.params.type === "agent_message_chunk" &&
      !context.hasReceivedAssistantContent &&
      sessionId
    ) {
      return { type: "assistant_content_received", sessionId };
    }

    return { type: "ignored" };
  }

  // JSON-RPC result (completion)
  if ("result" in event) {
    // Extract sessionId from context - we can't get it from result directly
    return { type: "turn_completed", sessionId: "" };
  }

  // JSON-RPC error
  if ("error" in event) {
    return {
      type: "error",
      message: event.error.message,
      sessionId: undefined,
    };
  }

  return { type: "ignored" };
};
