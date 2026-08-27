import { useAtomValue } from "@effect/atom-react";
import type { ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { environmentCatalog } from "../connection/catalog";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { isWindowsPlatform } from "../lib/utils";
import { environmentThreadShells } from "../state/threads";

/**
 * Count agents actively working on this machine: sessions in
 * "starting"/"running" across the primary backend and any desktop-local
 * secondary (e.g. the parallel WSL backend). Remote, SSH, and relay
 * environments are excluded — the tray describes this machine only.
 *
 * Known limitation: background liveness (subagents or watch loops that
 * outlive the turn) is not counted; the tray reads idle once the turn's
 * session settles.
 */
export function countLocalRunningAgents(
  entries: Iterable<readonly [EnvironmentId, ConnectionCatalogEntry]>,
  threadsForEnvironment: (
    environmentId: EnvironmentId,
  ) => ReadonlyArray<Pick<OrchestrationThreadShell, "session">>,
): number {
  let count = 0;
  for (const [environmentId, entry] of entries) {
    const isLocal =
      entry.target._tag === "PrimaryConnectionTarget" ||
      isDesktopLocalConnectionTarget(entry.target);
    if (!isLocal) continue;
    for (const thread of threadsForEnvironment(environmentId)) {
      const status = thread.session?.status;
      if (status === "starting" || status === "running") count += 1;
    }
  }
  return count;
}

// Derived from thread shells: the shell snapshot stream carries every
// thread's session status, so the count stays live without opening
// per-thread detail subscriptions (those stream full message payloads).
const localRunningAgentCountAtom = Atom.make((get) =>
  countLocalRunningAgents(get(environmentCatalog.catalogValueAtom).entries, (environmentId) =>
    get(environmentThreadShells.environmentThreadsAtom(environmentId)),
  ),
).pipe(Atom.withLabel("tray-local-running-agent-count"));

const DISABLED_COUNT_ATOM = Atom.make(0).pipe(Atom.withLabel("tray-local-running-agent-count:off"));

// Resolved once at import time; the preload script injects the bridge before
// app scripts run, so this never appears later. `undefined` on the web build.
// The tray itself is Windows-only, so skip the sync (and its thread-state
// subscription) on desktop hosts that expose the bridge but show no tray.
const setTrayRunningCount =
  typeof window !== "undefined" && isWindowsPlatform(window.navigator.platform)
    ? window.desktopBridge?.setTrayRunningCount
    : undefined;

/**
 * Syncs the count of running local agents to the desktop tray (Windows).
 * The tray shows "N agents running" in its header and tooltip.
 * No-op when not running inside Electron desktop.
 */
export function useTrayRunningCountSync(): void {
  const runningCount = useAtomValue(
    setTrayRunningCount === undefined ? DISABLED_COUNT_ATOM : localRunningAgentCountAtom,
  );

  useEffect(() => {
    if (setTrayRunningCount === undefined) return;
    void setTrayRunningCount(runningCount).catch(() => undefined);
  }, [runningCount]);
}
