import { Effect } from "effect";
import type { UserEntry } from "../../../../lib/conversation-schema/entry/UserEntrySchema";
import type { UserMessageInput } from "../schema";
import type { InitMessageContext } from "../types";
import * as ClaudeCode from "./ClaudeCode";
import type * as CCTurn from "./ClaudeCodeTurn";
import * as ClaudeCodeVersion from "./ClaudeCodeVersion";

export type CCSessionProcessDef = {
  sessionProcessId: string;
  projectId: string;
  cwd: string;
  abortController: AbortController;
  setNextMessage: (input: UserMessageInput) => void;
};

type CCSessionProcessStateBase = {
  def: CCSessionProcessDef;
  tasks: CCTurn.ClaudeCodeTurnState[];
};

export type CCSessionProcessPendingState = CCSessionProcessStateBase & {
  type: "pending";
  sessionId?: undefined;
  currentTask: CCTurn.PendingClaudeCodeTurnState;
};

export type CCSessionProcessNotInitializedState = CCSessionProcessStateBase & {
  type: "not_initialized";
  sessionId?: undefined;
  currentTask: CCTurn.RunningClaudeCodeTurnState;
  rawUserMessage: string;
};

export type CCSessionProcessInitializedState = CCSessionProcessStateBase & {
  type: "initialized";
  sessionId: string;
  currentTask: CCTurn.RunningClaudeCodeTurnState;
  rawUserMessage: string;
  initContext: InitMessageContext;
};

export type CCSessionProcessFileCreatedState = CCSessionProcessStateBase & {
  type: "file_created";
  sessionId: string;
  currentTask: CCTurn.RunningClaudeCodeTurnState;
  rawUserMessage: string;
  initContext: InitMessageContext;
};

export type CCSessionProcessPausedState = CCSessionProcessStateBase & {
  type: "paused";
  sessionId: string;
};

export type CCSessionProcessCompletedState = CCSessionProcessStateBase & {
  type: "completed";
  sessionId?: string | undefined;
};

export type CCSessionProcessStatePublic =
  | CCSessionProcessInitializedState
  | CCSessionProcessFileCreatedState
  | CCSessionProcessPausedState;

export type CCSessionProcessState =
  | CCSessionProcessPendingState
  | CCSessionProcessNotInitializedState
  | CCSessionProcessStatePublic
  | CCSessionProcessCompletedState;

export const isPublic = (
  process: CCSessionProcessState,
): process is CCSessionProcessStatePublic => {
  return (
    process.type === "initialized" ||
    process.type === "file_created" ||
    process.type === "paused"
  );
};

export const getAliveTasks = (
  process: CCSessionProcessState,
): CCTurn.AliveClaudeCodeTurnState[] => {
  return process.tasks.filter(
    (task) => task.status === "pending" || task.status === "running",
  );
};

export const createVirtualConversation = (
  process: CCSessionProcessState,
  ctx: {
    sessionId: string;
    userMessage: string;
  },
) => {
  const timestamp = new Date().toISOString();

  return Effect.gen(function* () {
    const config = yield* ClaudeCode.Config;

    const virtualConversation: UserEntry = {
      type: "user",
      message: {
        role: "user",
        content: ctx.userMessage,
      },
      isSidechain: false,
      userType: "external",
      cwd: process.def.cwd,
      sessionId: ctx.sessionId,
      version: config.claudeCodeVersion
        ? ClaudeCodeVersion.versionText(config.claudeCodeVersion)
        : "unknown",
      uuid: `vc__${ctx.sessionId}__${timestamp}`,
      timestamp,
      parentUuid: null,
    };

    return virtualConversation;
  });
};
