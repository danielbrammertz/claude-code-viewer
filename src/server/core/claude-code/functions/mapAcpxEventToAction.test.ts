import { describe, expect, it } from "vitest";
import type { AcpxNdjsonEvent } from "../models/AcpxEvent";
import { mapAcpxEventToAction } from "./mapAcpxEventToAction";

const makeSessionUpdate = (
  type: string,
  sessionId: string,
): AcpxNdjsonEvent => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: { type, sessionId, data: {} },
});

const makeResult = (stopReason?: string): AcpxNdjsonEvent => ({
  jsonrpc: "2.0",
  id: 1,
  result: { ...(stopReason ? { stopReason } : {}) },
});

const makeError = (message: string): AcpxNdjsonEvent => ({
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32000, message },
});

describe("mapAcpxEventToAction", () => {
  describe("session_initialized", () => {
    it("returns session_initialized on first notification with sessionId", () => {
      const event = makeSessionUpdate("agent_message_chunk", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: false,
        hasReceivedAssistantContent: false,
      });
      expect(action).toEqual({
        type: "session_initialized",
        sessionId: "sess-1",
      });
    });

    it("does not return session_initialized if hasSessionId is already true", () => {
      const event = makeSessionUpdate("agent_message_chunk", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: false,
      });
      // Should be assistant_content_received since it's agent_message_chunk
      expect(action.type).toBe("assistant_content_received");
    });
  });

  describe("assistant_content_received", () => {
    it("returns assistant_content_received on first agent_message_chunk after sessionId known", () => {
      const event = makeSessionUpdate("agent_message_chunk", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: false,
      });
      expect(action).toEqual({
        type: "assistant_content_received",
        sessionId: "sess-1",
      });
    });

    it("returns ignored for subsequent agent_message_chunk events", () => {
      const event = makeSessionUpdate("agent_message_chunk", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: true,
      });
      expect(action.type).toBe("ignored");
    });

    it("returns ignored for tool_call after sessionId known (not agent_message_chunk)", () => {
      const event = makeSessionUpdate("tool_call", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: false,
      });
      expect(action.type).toBe("ignored");
    });
  });

  describe("turn_completed", () => {
    it("returns turn_completed on JSON-RPC result", () => {
      const event = makeResult("end_turn");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: true,
      });
      expect(action.type).toBe("turn_completed");
    });

    it("returns turn_completed on JSON-RPC result without stopReason", () => {
      const event = makeResult();
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: true,
      });
      expect(action.type).toBe("turn_completed");
    });
  });

  describe("error", () => {
    it("returns error on JSON-RPC error", () => {
      const event = makeError("Session not found");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: false,
        hasReceivedAssistantContent: false,
      });
      expect(action).toEqual({
        type: "error",
        message: "Session not found",
        sessionId: undefined,
      });
    });
  });

  describe("ignored", () => {
    it("returns ignored for usage_update after session initialized", () => {
      const event = makeSessionUpdate("usage_update", "sess-1");
      const action = mapAcpxEventToAction(event, {
        hasSessionId: true,
        hasReceivedAssistantContent: true,
      });
      expect(action.type).toBe("ignored");
    });
  });
});
