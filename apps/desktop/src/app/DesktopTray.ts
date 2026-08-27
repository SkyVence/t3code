import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTray from "../electron/ElectronTray.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";

export class DesktopTrayError extends Schema.TaggedErrorClass<DesktopTrayError>()(
  "DesktopTrayError",
  {
    reason: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type DesktopTrayMenuAction =
  | "show"
  | "settings"
  | "toggle-close-to-tray"
  | "quit"
  | "disable-agents";

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
      label: input.agentsPaused ? "Resume agents" : "Pause agents",
      click: () => input.onAction("disable-agents"),
    },
    {
      label: input.closeToTray ? "Disable background service" : "Enable background service",
      click: () => input.onAction("toggle-close-to-tray"),
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
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;

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
              yield* desktopWindow.revealOrCreateMain.pipe(
                Effect.catch((error) =>
                  logTrayWarning("failed to reveal window from tray", {
                    error: (error as any).message,
                  }),
                ),
              );
              break;
            }
            case "settings": {
              // Open main window then dispatch settings navigation. Reuse menu channel.
              yield* desktopWindow.revealOrCreateMain.pipe(
                Effect.catch((error) =>
                  logTrayWarning("failed to reveal window for settings", {
                    error: (error as any).message,
                  }),
                ),
              );
              // Best-effort: ask renderer to open settings via existing menu channel.
              const windowOption = yield* electronWindow.currentMainOrFirst.pipe(
                Effect.orElseSucceed(() => Option.none()),
              );
              if (Option.isSome(windowOption) && !windowOption.value.isDestroyed()) {
                windowOption.value.webContents.send("t3-menu-action", "open-settings");
              }
              break;
            }
            case "disable-agents": {
              const next = !(yield* Ref.get(pausedRef));
              yield* Ref.set(pausedRef, next);
              yield* rebuildMenu;
              yield* electronTray.setToolTip(tray, yield* getTooltip).pipe(Effect.ignore);
              yield* logTrayInfo(next ? "agents paused from tray" : "agents resumed from tray");
              break;
            }
            case "toggle-close-to-tray": {
              const current = yield* settings.get;
              const next = !current.closeToTray;
              yield* settings.setCloseToTray(next).pipe(Effect.ignore);
              yield* rebuildMenu;
              yield* logTrayInfo("closeToTray toggled from tray", { enabled: next });
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
    // Prefer ico on Windows, png elsewhere. Fall back to empty NativeImage if probing failed.
    const preferredIconPath = Option.match(
      Option.orElse(iconPaths.ico, () => iconPaths.png),
      {
        onNone: () => undefined,
        onSome: (p) => p,
      },
    );

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
    yield* electronTray.onClick(tray, () => {
      void Effect.runPromise(
        desktopWindow.revealOrCreateMain.pipe(
          Effect.catch((error) =>
            logTrayWarning("failed to reveal on tray click", { error: (error as any).message }),
          ),
        ),
      );
    });
    yield* electronTray.onDoubleClick(tray, () => {
      void Effect.runPromise(
        desktopWindow.revealOrCreateMain.pipe(
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
