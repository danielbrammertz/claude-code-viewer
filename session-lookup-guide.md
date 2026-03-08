# ACPX Session Lookup Guide

How to find ACPX session records from external tools using the filesystem.

## Storage Layout

All sessions are stored as individual JSON files:

```
~/.acpx/sessions/<url-encoded-acpx-record-id>.json
```

Each file uses the schema `"acpx.session.v1"` and contains snake_case keys.

## Relevant Fields in Each Session File

```jsonc
{
  "schema": "acpx.session.v1",
  "acpx_record_id": "e4a7c...",   // ACPX's own stable primary key (= filename)
  "acp_session_id": "e4a7c...",   // ACP protocol session ID (may differ after reconnect)
  "agent_session_id": "abc-123",  // Claude Code's internal session ID (optional, from _meta)
  "agent_command": "npx -y @anthropic-ai/claude-code-acp@latest",
  "cwd": "/Users/me/my-project",  // absolute working directory
  "closed": false,                // true if session was explicitly closed
  "name": null,                   // optional named session identifier
  "pid": 12345,                   // agent process PID (if running)
  "created_at": "2026-03-04T...",
  "last_used_at": "2026-03-04T..."
}
```

### ID Relationships

| Field | What it is | Stability |
|---|---|---|
| `acpx_record_id` | ACPX's own primary key, used as filename | Never changes |
| `acp_session_id` | ACP protocol session ID | May change on reconnect (session re-creation) |
| `agent_session_id` | Claude Code's own session ID | Set from `_meta.agentSessionId` in ACP response; may be absent |

At creation time `acpx_record_id === acp_session_id`. They can diverge later if the ACP session is re-created on reconnect, but `acpx_record_id` (and thus the filename) stays stable.

## Lookup: Find ACPX Session by Working Directory

Scan all `.json` files in `~/.acpx/sessions/`, parse each one, and match on the `cwd` field.

### Shell (jq)

```bash
ACPX_DIR="$HOME/.acpx/sessions"
TARGET_CWD="/Users/me/my-project"

for f in "$ACPX_DIR"/*.json; do
  cwd=$(jq -r '.cwd // empty' "$f" 2>/dev/null)
  closed=$(jq -r '.closed // false' "$f" 2>/dev/null)
  if [ "$cwd" = "$TARGET_CWD" ] && [ "$closed" != "true" ]; then
    echo "=== Match: $f ==="
    jq '{
      acpx_record_id,
      acp_session_id,
      agent_session_id,
      cwd,
      agent_command,
      closed
    }' "$f"
  fi
done
```

### Node.js / TypeScript

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type AcpxSessionInfo = {
  acpx_record_id: string;
  acp_session_id: string;
  agent_session_id?: string;
  cwd: string;
  agent_command: string;
  closed: boolean;
  name?: string;
};

function getSessionDir(): string {
  return path.join(os.homedir(), ".acpx", "sessions");
}

function readAllSessions(): AcpxSessionInfo[] {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (raw.schema !== "acpx.session.v1") return null;
        return {
          acpx_record_id: raw.acpx_record_id,
          acp_session_id: raw.acp_session_id,
          agent_session_id: raw.agent_session_id ?? undefined,
          cwd: raw.cwd,
          agent_command: raw.agent_command,
          closed: raw.closed ?? false,
          name: raw.name ?? undefined,
        } satisfies AcpxSessionInfo;
      } catch {
        return null;
      }
    })
    .filter((s): s is AcpxSessionInfo => s !== null);
}
```

## Lookup: Find Session by `cwd`

```typescript
function findSessionByCwd(cwd: string): AcpxSessionInfo | undefined {
  const target = path.resolve(cwd);
  return readAllSessions().find((s) => s.cwd === target && !s.closed);
}
```

## Lookup: Find Session by `cwd` + Claude Code Session ID

```typescript
function findSessionByCwdAndClaudeSessionId(
  cwd: string,
  claudeSessionId: string,
): AcpxSessionInfo | undefined {
  const target = path.resolve(cwd);
  return readAllSessions().find(
    (s) => s.cwd === target && s.agent_session_id === claudeSessionId && !s.closed,
  );
}
```

## Lookup: Find Session by `cwd` with Directory Walk (matching ACPX behavior)

ACPX walks **up** the directory tree from the given cwd to the git root, looking for a session at each level. This means a session created at `/Users/me/my-project` will also match when you query from `/Users/me/my-project/src/components`.

```typescript
import { execSync } from "node:child_process";

function findGitRoot(startDir: string): string | undefined {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function findSessionByDirectoryWalk(cwd: string): AcpxSessionInfo | undefined {
  const sessions = readAllSessions().filter((s) => !s.closed);
  const startDir = path.resolve(cwd);
  const boundary = findGitRoot(startDir) ?? startDir;

  let current = startDir;
  while (true) {
    const match = sessions.find((s) => s.cwd === current);
    if (match) return match;

    if (current === boundary || current === path.parse(current).root) {
      return undefined;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
```

## Lookup: Find Session by Claude Code Session ID Only

```typescript
function findSessionByClaudeSessionId(
  claudeSessionId: string,
): AcpxSessionInfo | undefined {
  return readAllSessions().find(
    (s) => s.agent_session_id === claudeSessionId && !s.closed,
  );
}
```

## Python

```python
import json
import os
from pathlib import Path
from typing import Optional

SESSION_DIR = Path.home() / ".acpx" / "sessions"

def read_all_sessions() -> list[dict]:
    if not SESSION_DIR.is_dir():
        return []

    sessions = []
    for f in SESSION_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            if data.get("schema") != "acpx.session.v1":
                continue
            sessions.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return sessions

def find_session_by_cwd(cwd: str) -> Optional[dict]:
    target = str(Path(cwd).resolve())
    for s in read_all_sessions():
        if s.get("cwd") == target and not s.get("closed", False):
            return s
    return None

def find_session_by_cwd_and_claude_id(cwd: str, claude_session_id: str) -> Optional[dict]:
    target = str(Path(cwd).resolve())
    for s in read_all_sessions():
        if (s.get("cwd") == target
            and s.get("agent_session_id") == claude_session_id
            and not s.get("closed", False)):
            return s
    return None
```

## Important Notes

1. **Full scan required**: There is no index. Every lookup reads all session files.
2. **Schema validation**: Always check `"schema": "acpx.session.v1"` before trusting the data.
3. **`agent_session_id` may be absent**: Claude Code only reports its session ID via `_meta.agentSessionId` in the ACP response. If the adapter doesn't include it, this field will be missing.
4. **`closed` sessions**: Filter out sessions with `"closed": true` unless you explicitly want historical sessions.
5. **Named sessions**: Multiple sessions can exist for the same `cwd` if they have different `name` values. Filter by `name` if needed (unnamed sessions have `name: null`).
6. **Filename encoding**: The filename is `encodeURIComponent(acpx_record_id) + ".json"`. To go from filename to record ID: `decodeURIComponent(filename.replace(/\.json$/, ""))`.
