import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import {
  EnvironmentId,
  ThreadId,
  type OrchestrationSession,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { desktopLocalConnectionId } from "../connection/desktopLocal";
import { countLocalRunningAgents } from "./useTrayRunningCountSync";

const PRIMARY_ID = EnvironmentId.make("environment-primary");
const WSL_ID = EnvironmentId.make("environment-wsl");
const REMOTE_ID = EnvironmentId.make("environment-remote");

const PRIMARY_ENTRY: ConnectionCatalogEntry = {
  target: new PrimaryConnectionTarget({
    environmentId: PRIMARY_ID,
    label: "This device",
    httpBaseUrl: "http://127.0.0.1:3773",
    wsBaseUrl: "ws://127.0.0.1:3773",
  }),
  profile: Option.none(),
};

const WSL_ENTRY: ConnectionCatalogEntry = {
  target: new BearerConnectionTarget({
    connectionId: desktopLocalConnectionId("wsl:Ubuntu"),
    environmentId: WSL_ID,
    label: "WSL (Ubuntu)",
  }),
  profile: Option.none(),
};

const REMOTE_ENTRY: ConnectionCatalogEntry = {
  target: new BearerConnectionTarget({
    connectionId: "saved-remote",
    environmentId: REMOTE_ID,
    label: "Studio desktop",
  }),
  profile: Option.none(),
};

function session(status: OrchestrationSessionStatus): { session: OrchestrationSession } {
  return {
    session: {
      threadId: ThreadId.make("thread-1"),
      status,
      providerName: "codex",
      runtimeMode: "auto",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  };
}

describe("countLocalRunningAgents", () => {
  it("counts starting and running sessions across local environments", () => {
    const threadsByEnvironment = new Map([
      [PRIMARY_ID, [session("running"), session("starting"), session("idle")]],
      [WSL_ID, [session("running")]],
    ]);

    const count = countLocalRunningAgents(
      [
        [PRIMARY_ID, PRIMARY_ENTRY],
        [WSL_ID, WSL_ENTRY],
      ],
      (environmentId) => threadsByEnvironment.get(environmentId) ?? [],
    );

    expect(count).toBe(3);
  });

  it("ignores settled sessions and threads without a session", () => {
    const count = countLocalRunningAgents([[PRIMARY_ID, PRIMARY_ENTRY]], () => [
      session("idle"),
      session("ready"),
      session("interrupted"),
      session("stopped"),
      session("error"),
      { session: null },
    ]);

    expect(count).toBe(0);
  });

  it("excludes remote environments from the local count", () => {
    const threadsByEnvironment = new Map([
      [PRIMARY_ID, [session("running")]],
      [REMOTE_ID, [session("running"), session("running")]],
    ]);

    const count = countLocalRunningAgents(
      [
        [PRIMARY_ID, PRIMARY_ENTRY],
        [REMOTE_ID, REMOTE_ENTRY],
      ],
      (environmentId) => threadsByEnvironment.get(environmentId) ?? [],
    );

    expect(count).toBe(1);
  });
});
