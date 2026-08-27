import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export class ElectronTrayCreateError extends Schema.TaggedErrorClass<ElectronTrayCreateError>()(
  "ElectronTrayCreateError",
  {
    iconPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to create Electron Tray with icon "${this.iconPath}".`;
  }
}

export class ElectronTrayOperationError extends Schema.TaggedErrorClass<ElectronTrayOperationError>()(
  "ElectronTrayOperationError",
  {
    operation: Schema.Literals([
      "set-tooltip",
      "set-context-menu",
      "set-image",
      "destroy",
      "pop-up-context-menu",
    ]),
    platform: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron Tray operation ${JSON.stringify(this.operation)} failed on ${this.platform}.`;
  }
}

export class ElectronTray extends Context.Service<
  ElectronTray,
  {
    readonly create: (
      iconPath: string | undefined,
    ) => Effect.Effect<Electron.Tray, ElectronTrayCreateError>;
    readonly setToolTip: (
      tray: Electron.Tray,
      tooltip: string,
    ) => Effect.Effect<void, ElectronTrayOperationError>;
    readonly setImage: (
      tray: Electron.Tray,
      image: Electron.NativeImage | string,
    ) => Effect.Effect<void, ElectronTrayOperationError>;
    readonly setContextMenu: (
      tray: Electron.Tray,
      template: readonly Electron.MenuItemConstructorOptions[],
    ) => Effect.Effect<void, ElectronTrayOperationError>;
    readonly popUpContextMenu: (
      tray: Electron.Tray,
      menu: Electron.Menu,
    ) => Effect.Effect<void, ElectronTrayOperationError>;
    readonly destroy: (tray: Electron.Tray) => Effect.Effect<void, ElectronTrayOperationError>;
    readonly onClick: (
      tray: Electron.Tray,
      listener: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly onDoubleClick: (
      tray: Electron.Tray,
      listener: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly isDestroyed: (tray: Electron.Tray) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/electron/ElectronTray") {}

const addScopedTrayListener = (
  tray: Electron.Tray,
  eventName: "click" | "double-click",
  listener: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      tray.on(eventName as any, listener as any);
    }),
    () =>
      Effect.sync(() => {
        tray.removeListener(eventName as any, listener as any);
      }),
  ).pipe(Effect.asVoid);

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;

  return ElectronTray.of({
    create: (iconPath) =>
      Effect.try({
        try: () => {
          if (iconPath === undefined) {
            return new Electron.Tray(Electron.nativeImage.createEmpty());
          }
          const nativeImage = Electron.nativeImage.createFromPath(iconPath);
          return new Electron.Tray(nativeImage.isEmpty() ? iconPath : nativeImage);
        },
        catch: (cause) =>
          new ElectronTrayCreateError({
            iconPath: iconPath ?? "NativeImage",
            cause,
          }),
      }),
    setToolTip: (tray, tooltip) =>
      Effect.try({
        try: () => tray.setToolTip(tooltip),
        catch: (cause) =>
          new ElectronTrayOperationError({
            operation: "set-tooltip",
            platform,
            cause,
          }),
      }).pipe(Effect.asVoid),
    setImage: (tray, image) =>
      Effect.try({
        try: () => tray.setImage(image as any),
        catch: (cause) =>
          new ElectronTrayOperationError({
            operation: "set-image",
            platform,
            cause,
          }),
      }).pipe(Effect.asVoid),
    setContextMenu: (tray, template) =>
      Effect.try({
        try: () => {
          const menu = Electron.Menu.buildFromTemplate([...template]);
          tray.setContextMenu(menu);
        },
        catch: (cause) =>
          new ElectronTrayOperationError({
            operation: "set-context-menu",
            platform,
            cause,
          }),
      }).pipe(Effect.asVoid),
    popUpContextMenu: (tray, menu) =>
      Effect.try({
        try: () => tray.popUpContextMenu(menu),
        catch: (cause) =>
          new ElectronTrayOperationError({
            operation: "pop-up-context-menu",
            platform,
            cause,
          }),
      }).pipe(Effect.asVoid),
    destroy: (tray) =>
      Effect.try({
        try: () => tray.destroy(),
        catch: (cause) =>
          new ElectronTrayOperationError({
            operation: "destroy",
            platform,
            cause,
          }),
      }).pipe(Effect.asVoid),
    onClick: (tray, listener) => addScopedTrayListener(tray, "click", listener),
    onDoubleClick: (tray, listener) => addScopedTrayListener(tray, "double-click", listener),
    isDestroyed: (tray) =>
      Effect.sync(() => {
        try {
          return (tray as unknown as { isDestroyed?: () => boolean }).isDestroyed?.() ?? false;
        } catch {
          return false;
        }
      }),
  });
});

export const layer = Layer.effect(ElectronTray, make);

/**
 * Test layer that never touches native Electron.Tray. Useful when tray behavior
 * is asserted through contract tests rather than OS integration.
 */
export const layerTest = (
  overrides?: Partial<ElectronTray["Service"]>,
): Layer.Layer<ElectronTray> =>
  Layer.succeed(
    ElectronTray,
    ElectronTray.of({
      create: () => Effect.die("ElectronTray.layerTest does not support create"),
      setToolTip: () => Effect.void,
      setImage: () => Effect.void,
      setContextMenu: () => Effect.void,
      popUpContextMenu: () => Effect.void,
      destroy: () => Effect.void,
      onClick: () => Effect.void,
      onDoubleClick: () => Effect.void,
      isDestroyed: () => Effect.succeed(false),
      ...overrides,
    }),
  );
