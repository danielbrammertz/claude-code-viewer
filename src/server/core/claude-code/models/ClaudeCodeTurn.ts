import type { SandboxSettings } from "../schema";

type BaseClaudeCodeTurnDef = {
  turnId: string;
};

/**
 * Standalone CCOptions type (previously derived from agentSdk.Options via Pick).
 */
export type CCOptions = {
  disallowedTools?: string[];
  settingSources?: Array<"user" | "project" | "local">;
  systemPrompt?:
    | string
    | {
        type: "preset";
        preset: "claude_code";
        append?: string;
      };
  model?: string;
  sandbox?: SandboxSettings;
  maxTurns?: number;
  maxThinkingTokens?: number;
  env?: Record<string, string | undefined>;
  maxBudgetUsd?: number;
};

export type NewClaudeCodeTurnDef = BaseClaudeCodeTurnDef & {
  type: "new"; // new session
  sessionId?: undefined;
  baseSessionId?: undefined;
  ccOptions?: CCOptions;
};

export type ContinueClaudeCodeTurnDef = BaseClaudeCodeTurnDef & {
  type: "continue"; // continue from current session process
  sessionId: string;
  baseSessionId: string;
};

export type ResumeClaudeCodeTurnDef = BaseClaudeCodeTurnDef & {
  type: "resume"; // resume from base session process
  sessionId?: undefined;
  baseSessionId: string;
  ccOptions?: CCOptions;
};

export type ForkClaudeCodeTurnDef = BaseClaudeCodeTurnDef & {
  type: "fork"; // fork from base session process
  sessionId: string;
  baseSessionId: string;
  ccOptions?: CCOptions;
};

export type ClaudeCodeTaskDef =
  | NewClaudeCodeTurnDef
  | ContinueClaudeCodeTurnDef
  | ResumeClaudeCodeTurnDef
  | ForkClaudeCodeTurnDef;

type ClaudeCodeTurnStateBase = {
  def: ClaudeCodeTaskDef;
};

export type PendingClaudeCodeTurnState = ClaudeCodeTurnStateBase & {
  status: "pending";
  sessionId?: undefined;
};

export type RunningClaudeCodeTurnState = ClaudeCodeTurnStateBase & {
  status: "running";
  sessionId?: undefined;
};

export type CompletedClaudeCodeTurnState = ClaudeCodeTurnStateBase & {
  status: "completed";
  sessionId?: string | undefined;
};

export type FailedClaudeCodeTurnState = ClaudeCodeTurnStateBase & {
  status: "failed";
  error: unknown;
};

export type AliveClaudeCodeTurnState =
  | PendingClaudeCodeTurnState
  | RunningClaudeCodeTurnState;

export type ClaudeCodeTurnState =
  | AliveClaudeCodeTurnState
  | CompletedClaudeCodeTurnState
  | FailedClaudeCodeTurnState;
