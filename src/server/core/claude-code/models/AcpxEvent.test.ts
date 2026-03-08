import { describe, expect, it } from "vitest";
import {
  jsonRpcErrorSchema,
  jsonRpcResultSchema,
  parseAcpxNdjsonEvent,
  sessionUpdateGenericSchema,
} from "./AcpxEvent";

describe("AcpxEvent schemas", () => {
  describe("sessionUpdateGenericSchema", () => {
    it("parses a valid agent_message_chunk notification", () => {
      const event = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          type: "agent_message_chunk",
          sessionId: "sess-123",
          data: { content: "hello" },
        },
      };
      const result = sessionUpdateGenericSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("parses a valid tool_call notification", () => {
      const event = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          type: "tool_call",
          sessionId: "sess-456",
          data: { toolName: "Bash", toolInput: { command: "ls" } },
        },
      };
      const result = sessionUpdateGenericSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects event with wrong jsonrpc version", () => {
      const event = {
        jsonrpc: "1.0",
        method: "session/update",
        params: {
          type: "agent_message_chunk",
          sessionId: "sess-123",
          data: {},
        },
      };
      const result = sessionUpdateGenericSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("rejects event with missing sessionId", () => {
      const event = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          type: "agent_message_chunk",
          data: {},
        },
      };
      const result = sessionUpdateGenericSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("jsonRpcResultSchema", () => {
    it("parses a valid result response with stopReason", () => {
      const event = {
        jsonrpc: "2.0",
        id: 1,
        result: { stopReason: "end_turn" },
      };
      const result = jsonRpcResultSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result.stopReason).toBe("end_turn");
      }
    });

    it("parses a valid result response without stopReason", () => {
      const event = {
        jsonrpc: "2.0",
        id: "req-1",
        result: {},
      };
      const result = jsonRpcResultSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("rejects result without id", () => {
      const event = {
        jsonrpc: "2.0",
        result: { stopReason: "end_turn" },
      };
      const result = jsonRpcResultSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("jsonRpcErrorSchema", () => {
    it("parses a valid error response", () => {
      const event = {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "Session not found",
          data: { acpxCode: "SESSION_NOT_FOUND" },
        },
      };
      const result = jsonRpcErrorSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error.message).toBe("Session not found");
      }
    });

    it("parses error without optional data field", () => {
      const event = {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32600,
          message: "Invalid request",
        },
      };
      const result = jsonRpcErrorSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });

  describe("parseAcpxNdjsonEvent", () => {
    it("parses session update notification", () => {
      const event = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          type: "usage_update",
          sessionId: "sess-789",
          data: { tokens: 100 },
        },
      };
      const result = parseAcpxNdjsonEvent(event);
      expect(result.success).toBe(true);
    });

    it("parses JSON-RPC result", () => {
      const event = {
        jsonrpc: "2.0",
        id: 1,
        result: { stopReason: "end_turn" },
      };
      const result = parseAcpxNdjsonEvent(event);
      expect(result.success).toBe(true);
    });

    it("parses JSON-RPC error", () => {
      const event = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "fail" },
      };
      const result = parseAcpxNdjsonEvent(event);
      expect(result.success).toBe(true);
    });

    it("rejects completely invalid object", () => {
      const event = { foo: "bar" };
      const result = parseAcpxNdjsonEvent(event);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = parseAcpxNdjsonEvent(null);
      expect(result.success).toBe(false);
    });

    it("rejects non-objects", () => {
      const result = parseAcpxNdjsonEvent("string");
      expect(result.success).toBe(false);
    });
  });
});
