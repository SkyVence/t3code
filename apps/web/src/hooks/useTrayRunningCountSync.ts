import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useThreadRefs } from "../state/entities";
import { environmentThreadDetails } from "../state/threads";

/**
 * Syncs the count of running agents/threads to the desktop tray (Windows).
 * The tray shows "N agents running" in its header and tooltip.
 * No-op when not running inside Electron desktop.
 */
export function useTrayRunningCountSync(): void {
  const threadRefs = useThreadRefs();

  const runningCount = useMemo(() => {
    let count = 0;
    for (const ref of threadRefs) {
      const detailAtom = environmentThreadDetails.detailAtom(ref);
      const detail = appAtomRegistry.get(detailAtom);
      // detail.session?.status is the orchestration session status;
      // "running" and "starting" are the active states (see
      // shouldPersistThread in client-runtime/state/threads.ts).
      const status = detail?.session?.status;
      if (status === "running" || status === "starting") count += 1;
    }
    return count;
  }, [threadRefs]);

  useEffect(() => {
    const bridge = (
      window as unknown as {
        desktopBridge?: { setTrayRunningCount?: (n: number) => Promise<void> };
      }
    ).desktopBridge;
    if (!bridge?.setTrayRunningCount) return;
    void bridge.setTrayRunningCount(runningCount).catch(() => undefined);
  }, [runningCount]);
}
