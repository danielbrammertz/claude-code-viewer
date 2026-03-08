import { describe, expect, it } from "vitest";
import { parseAcpxNdjsonLine } from "./parseAcpxNdjsonLine";

describe("parseAcpxNdjsonLine", () => {
  it("parses a valid session/update notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        type: "agent_message_chunk",
        sessionId: "sess-123",
        data: { content: "hello" },
      },
    });
    const result = parseAcpxNdjsonLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("method" in result.event && result.event.method).toBe(
        "session/update",
      );
    }
  });

  it("parses a valid JSON-RPC result", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { stopReason: "end_turn" },
    });
    const result = parseAcpxNdjsonLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("result" in result.event).toBe(true);
    }
  });

  it("parses a valid JSON-RPC error", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "fail" },
    });
    const result = parseAcpxNdjsonLine(line);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("error" in result.event).toBe(true);
    }
  });

  it("returns failure for empty string", () => {
    const result = parseAcpxNdjsonLine("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.rawLine).toBe("");
    }
  });

  it("returns failure for whitespace-only string", () => {
    const result = parseAcpxNdjsonLine("   ");
    expect(result.success).toBe(false);
  });

  it("returns failure for invalid JSON", () => {
    const result = parseAcpxNdjsonLine("{not valid json}");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.rawLine).toBe("{not valid json}");
    }
  });

  it("returns failure for valid JSON that does not match schema", () => {
    const result = parseAcpxNdjsonLine(JSON.stringify({ foo: "bar" }));
    expect(result.success).toBe(false);
  });

  it("handles line with leading/trailing whitespace", () => {
    const line = `  ${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: {},
    })}  `;
    const result = parseAcpxNdjsonLine(line);
    expect(result.success).toBe(true);
  });
});
