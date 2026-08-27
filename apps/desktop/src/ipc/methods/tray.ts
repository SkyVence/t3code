import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopTray from "../../app/DesktopTray.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const TraySettingsSchema = Schema.Struct({
  closeToTray: Schema.Boolean,
  minimizeToTray: Schema.Boolean,
});

export const getTraySettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_TRAY_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: TraySettingsSchema,
  handler: Effect.fn("desktop.ipc.tray.get")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const settings = yield* appSettings.get;
    return {
      closeToTray: settings.closeToTray,
      minimizeToTray: settings.minimizeToTray,
    };
  }),
});

export const setCloseToTray = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CLOSE_TO_TRAY_CHANNEL,
  payload: Schema.Boolean,
  result: TraySettingsSchema,
  handler: Effect.fn("desktop.ipc.tray.setCloseToTray")(function* (enabled: boolean) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const result = yield* appSettings.setCloseToTray(enabled);
    return {
      closeToTray: result.settings.closeToTray,
      minimizeToTray: result.settings.minimizeToTray,
    };
  }),
});

export const setMinimizeToTray = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_MINIMIZE_TO_TRAY_CHANNEL,
  payload: Schema.Boolean,
  result: TraySettingsSchema,
  handler: Effect.fn("desktop.ipc.tray.setMinimizeToTray")(function* (enabled: boolean) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const result = yield* appSettings.setMinimizeToTray(enabled);
    return {
      closeToTray: result.settings.closeToTray,
      minimizeToTray: result.settings.minimizeToTray,
    };
  }),
});

export const setTrayRunningCount = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_TRAY_RUNNING_COUNT_CHANNEL,
  payload: Schema.Number,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.tray.setRunningCount")(function* (count: number) {
    const tray = yield* DesktopTray.DesktopTray;
    yield* tray.updateRunningCount(count);
  }),
});
