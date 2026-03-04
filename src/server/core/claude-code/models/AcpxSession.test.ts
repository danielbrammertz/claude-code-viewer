import { describe, expect, it } from "vitest";
import { acpxSessionSchema } from "./AcpxSession";

describe("AcpxSession schema", () => {
  it("parses a valid session file", () => {
    const session = {
      schema: "acpx.session.v1",
      acpx_record_id: "rec-001",
      acp_session_id: "acp-sess-001",
      agent_session_id: "agent-sess-001",
      cwd: "/home/user/project",
      closed: false,
      name: "my-session",
      pid: 12345,
    };
    const result = acpxSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.closed).toBe(false);
      expect(result.data.cwd).toBe("/home/user/project");
    }
  });

  it("parses a session without optional fields", () => {
    const session = {
      schema: "acpx.session.v1",
      acpx_record_id: "rec-002",
      acp_session_id: "acp-sess-002",
      agent_session_id: "agent-sess-002",
      cwd: "/tmp/project",
      closed: true,
    };
    const result = acpxSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
      expect(result.data.pid).toBeUndefined();
    }
  });

  it("rejects a session with wrong schema version", () => {
    const session = {
      schema: "acpx.session.v2",
      acpx_record_id: "rec-003",
      acp_session_id: "acp-sess-003",
      agent_session_id: "agent-sess-003",
      cwd: "/tmp",
      closed: false,
    };
    const result = acpxSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it("parses a session without agent_session_id", () => {
    const session = {
      schema: "acpx.session.v1",
      acpx_record_id: "rec-005",
      acp_session_id: "acp-sess-005",
      cwd: "/home/user/project",
      closed: false,
    };
    const result = acpxSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agent_session_id).toBeUndefined();
    }
  });

  it("rejects a session with missing required fields", () => {
    const session = {
      schema: "acpx.session.v1",
      acpx_record_id: "rec-004",
      // missing acp_session_id, cwd, closed
    };
    const result = acpxSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });
});
