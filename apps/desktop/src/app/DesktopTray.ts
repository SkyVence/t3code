import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";

import * as FileSystem from "effect/FileSystem";

import * as Electron from "electron";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTray from "../electron/ElectronTray.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";

export class DesktopTrayError extends Schema.TaggedErrorClass<DesktopTrayError>()(
  "DesktopTrayError",
  {
    reason: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type DesktopTrayMenuAction = "show" | "settings" | "quit";

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    readonly register: Effect.Effect<void, DesktopTrayError, Scope.Scope>;
    readonly updateRunningCount: (count: number) => Effect.Effect<void>;
    readonly updateTooltip: (tooltip: string) => Effect.Effect<void>;
    readonly setAgentsPaused: (paused: boolean) => Effect.Effect<void>;
    readonly rebuildMenu: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopTray") {}

const { logInfo: logTrayInfo, logWarning: logTrayWarning } = makeComponentLogger("desktop-tray");

function buildTrayTooltip(params: {
  displayName: string;
  runningCount: number;
  paused: boolean;
}): string {
  if (params.paused) return `${params.displayName} — paused`;
  if (params.runningCount === 0) return `${params.displayName} — idle`;
  if (params.runningCount === 1) return `${params.displayName} — 1 agent running`;
  return `${params.displayName} — ${params.runningCount} agents running`;
}

function buildRunningLabel(count: number, paused: boolean): string {
  if (paused) return "Agents paused";
  if (count === 0) return "No agents running";
  if (count === 1) return "1 agent running";
  return `${count} agents running`;
}

/**
 * Constructs the context menu template for the tray. Exported for unit testing
 * without needing a live Electron.Tray.
 */
export function buildTrayMenuTemplate(input: {
  runningCount: number;
  agentsPaused: boolean;
  closeToTray: boolean;
  onAction: (action: DesktopTrayMenuAction) => void;
}): Electron.MenuItemConstructorOptions[] {
  // Tray is intentionally minimal — user asked to keep background-service
  // controls in Settings, not in the tray. Keep only show/settings/quit plus
  // a non-interactive header with the running-jobs count.
  void input.closeToTray;
  void input.agentsPaused;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: buildRunningLabel(input.runningCount, input.agentsPaused),
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Show T3 Code",
      click: () => input.onAction("show"),
    },
    {
      label: "Settings",
      click: () => input.onAction("settings"),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => input.onAction("quit"),
    },
  ];
  return template;
}

export const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronTray = yield* ElectronTray.ElectronTray;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  const fileSystem = yield* FileSystem.FileSystem;

  const runningCountRef = yield* Ref.make(0);
  const pausedRef = yield* Ref.make(false);
  const trayRef = yield* Ref.make<Option.Option<Electron.Tray>>(Option.none());

  const getTooltip = Effect.gen(function* () {
    const count = yield* Ref.get(runningCountRef);
    const paused = yield* Ref.get(pausedRef);
    return buildTrayTooltip({ displayName: environment.displayName, runningCount: count, paused });
  });

  const rebuildMenu = Effect.gen(function* () {
    const trayOption = yield* Ref.get(trayRef);
    if (Option.isNone(trayOption)) return;
    const tray = trayOption.value;
    const count = yield* Ref.get(runningCountRef);
    const paused = yield* Ref.get(pausedRef);
    const currentSettings = yield* settings.get;
    const tooltip = buildTrayTooltip({
      displayName: environment.displayName,
      runningCount: count,
      paused,
    });

    const onAction = (action: DesktopTrayMenuAction): void => {
      // Fire-and-forget to avoid blocking the menu click handler.
      void Effect.runPromise(
        Effect.gen(function* () {
          switch (action) {
            case "show": {
              // Use activate — it correctly re-reveals a hidden window or the
              // WSL splash, and avoids the blank-page stuck state seen with
              // revealOrCreateMain when the window was previously hidden.
              yield* desktopWindow.activate.pipe(
                Effect.catch((error) =>
                  logTrayWarning("failed to reveal window from tray", {
                    error: (error as any).message,
                  }),
                ),
              );
              break;
            }
            case "settings": {
              // Ensure window is visible first, then dispatch via the same
              // path the native menu uses (DesktopWindow → MENU_ACTION_CHANNEL).
              // This guarantees the renderer receives "open-settings" even if
              // it was just created or was hidden.
              yield* desktopWindow.activate.pipe(
                Effect.catch((error) =>
                  logTrayWarning("failed to reveal window for settings", {
                    error: (error as any).message,
                  }),
                ),
              );
              // Small delay to let the renderer finish load after reveal;
              // dispatchMenuAction handles isLoadingMainFrame internally.
              yield* desktopWindow.dispatchMenuAction("open-settings").pipe(
                Effect.catch((error) =>
                  logTrayWarning("failed to dispatch settings action", {
                    error: (error as any).message,
                  }),
                ),
              );
              break;
            }
            case "quit": {
              yield* Ref.set(state.quitting, true);
              yield* shutdown.request;
              yield* shutdown.awaitComplete.pipe(Effect.timeout(8_000), Effect.ignore);
              yield* electronApp.quit;
              break;
            }
          }
        }),
      );
    };

    const template = buildTrayMenuTemplate({
      runningCount: count,
      agentsPaused: paused,
      closeToTray: currentSettings.closeToTray,
      onAction,
    });

    yield* electronTray
      .setContextMenu(tray, template)
      .pipe(
        Effect.catch((error) =>
          logTrayWarning("failed to set tray menu", { error: error.message }),
        ),
      );
    yield* electronTray
      .setToolTip(tray, tooltip)
      .pipe(
        Effect.catch((error) =>
          logTrayWarning("failed to set tray tooltip", { error: error.message }),
        ),
      );
  });

  const register = Effect.gen(function* () {
    // Avoid duplicate tray on reloads / tests.
    const existing = yield* Ref.get(trayRef);
    if (Option.isSome(existing)) {
      yield* rebuildMenu;
      return;
    }

    const iconPaths = yield* assets.iconPaths;
    const currentSettingsForIcon = yield* settings.get.pipe(
      Effect.orElseSucceed(() => DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS),
    );
    // Prefer ico on Windows, png elsewhere. Fall back to empty NativeImage if probing failed.
    // For packaged builds iconPaths already holds the correct per-channel icon
    // (nightly vs stable) via electron-builder resources. For unpacked dev,
    // manually prefer the nightly icon when the update channel is nightly so
    // the tray matches the nightly/stable branding the user sees in the window.
    let preferredIconPath = Option.match(
      Option.orElse(iconPaths.ico, () => iconPaths.png),
      {
        onNone: () => undefined as string | undefined,
        onSome: (p) => p,
      },
    );
    if (currentSettingsForIcon.updateChannel === "nightly") {
      const nightlyCandidates = [
        `${environment.rootDir}/assets/nightly/nightly-windows.ico`,
        `${environment.rootDir}/assets/nightly/nightly-universal-1024.png`,
      ];
      for (const candidate of nightlyCandidates) {
        const exists = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
        if (exists) {
          preferredIconPath = candidate;
          break;
        }
      }
    }

    let nativeIcon: Electron.NativeImage | string;
    if (preferredIconPath !== undefined) {
      try {
        nativeIcon = Electron.nativeImage.createFromPath(preferredIconPath);
        if ((nativeIcon as Electron.NativeImage).isEmpty?.()) {
          nativeIcon = preferredIconPath;
        }
      } catch {
        nativeIcon = preferredIconPath;
      }
    } else {
      // Fallback: generate a 16x16 empty image; tray will still appear.
      nativeIcon = Electron.nativeImage.createEmpty();
    }

    const tray = yield* electronTray
      .create(nativeIcon)
      .pipe(Effect.mapError((cause) => new DesktopTrayError({ reason: "tray-create", cause })));

    yield* Ref.set(trayRef, Option.some(tray));

    // Clicking the tray icon reveals the window; double-click also handled.
    // Use activate to avoid the blank-page stuck state seen with
    // revealOrCreateMain when the window was previously hidden.
    yield* electronTray.onClick(tray, () => {
      void Effect.runPromise(
        desktopWindow.activate.pipe(
          Effect.catch((error) =>
            logTrayWarning("failed to reveal on tray click", { error: (error as any).message }),
          ),
        ),
      );
    });
    yield* electronTray.onDoubleClick(tray, () => {
      void Effect.runPromise(
        desktopWindow.activate.pipe(
          Effect.catch((error) =>
            logTrayWarning("failed to reveal on tray double-click", {
              error: (error as any).message,
            }),
          ),
        ),
      );
    });

    // Ensure tray is destroyed when the scope closes (app quit).
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const current = yield* Ref.getAndSet(trayRef, Option.none());
        if (Option.isSome(current)) {
          yield* electronTray.destroy(current.value).pipe(Effect.ignore);
        }
      }),
    );

    yield* rebuildMenu;
    yield* logTrayInfo("tray registered", { platform: environment.platform });
  }).pipe(Effect.withSpan("desktop.tray.register"));

  return DesktopTray.of({
    register,
    updateRunningCount: (count) =>
      Effect.gen(function* () {
        const safeCount = Math.max(0, Math.floor(count));
        yield* Ref.set(runningCountRef, safeCount);
        yield* rebuildMenu;
      }).pipe(Effect.withSpan("desktop.tray.updateRunningCount")),
    updateTooltip: (tooltip) =>
      Effect.gen(function* () {
        const trayOption = yield* Ref.get(trayRef);
        if (Option.isNone(trayOption)) return;
        yield* electronTray.setToolTip(trayOption.value, tooltip).pipe(Effect.ignore);
      }),
    setAgentsPaused: (paused) =>
      Effect.gen(function* () {
        yield* Ref.set(pausedRef, paused);
        yield* rebuildMenu;
      }),
    rebuildMenu,
  });
});

export const layer = Layer.effect(DesktopTray, make);
