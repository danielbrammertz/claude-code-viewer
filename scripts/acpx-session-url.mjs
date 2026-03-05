#!/usr/bin/env node

/**
 * Resolves an ACPX session name to a Claude Code Viewer URL.
 *
 * Usage:
 *   node scripts/acpx-session-url.mjs <baseUrl> <sessionName> [cwd]
 *
 * Arguments:
 *   baseUrl      - e.g. "https://claude.openclaw.nativai.de/"
 *   sessionName  - the ACPX session `name` field, e.g. "agent:claude:acp:66bf9228-..."
 *   cwd          - (optional) working directory to further filter matches
 *
 * Output:
 *   The full Claude Code Viewer URL for the matched session.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error(
    "Usage: node scripts/acpx-session-url.mjs <baseUrl> <sessionName> [cwd]",
  );
  process.exit(1);
}

const [baseUrl, sessionName, cwdFilter] = args;
const sessionsDir = join(homedir(), ".acpx", "sessions");

// 1. Read all session files
let files;
try {
  files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
} catch (err) {
  console.error(`Failed to read sessions directory: ${sessionsDir}`);
  console.error(err.message);
  process.exit(1);
}

// 2. Parse and filter by name (and optionally cwd)
const matches = [];
for (const file of files) {
  const filePath = join(sessionsDir, file);
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (data.name !== sessionName) continue;
    if (cwdFilter && data.cwd !== cwdFilter) continue;
    matches.push(data);
  } catch {
    // Skip files that can't be parsed
  }
}

if (matches.length === 0) {
  console.error(`No session found with name: ${sessionName}`);
  if (cwdFilter) {
    console.error(`  (filtered by cwd: ${cwdFilter})`);
  }
  process.exit(1);
}

// 3. Pick the most recently used session
matches.sort((a, b) => {
  const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
  const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
  return bTime - aTime;
});
const session = matches[0];

// 4. Compute the Claude project directory path
const claudeProjectsDir = join(homedir(), ".claude", "projects");
const mangledCwd = session.cwd.replace(/\/$/, "").replace(/[/.]/g, "-");
const claudeProjectDir = join(claudeProjectsDir, mangledCwd);

// 5. Compute projectId (base64url of the full path)
const projectId = Buffer.from(claudeProjectDir).toString("base64url");

// 6. Build the URL
const sessionId = session.acp_session_id;
const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
const url = `${normalizedBase}projects/${projectId}/session?sessionId=${sessionId}`;

console.log(url);
