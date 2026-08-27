import { assert, describe, it } from "@effect/vitest";

import * as DesktopTray from "./DesktopTray.ts";

describe("DesktopTray", () => {
  it("builds menu with idle label and enable background when closeToTray false", () => {
    const actions: DesktopTray.DesktopTrayMenuAction[] = [];
    const template = DesktopTray.buildTrayMenuTemplate({
      runningCount: 0,
      agentsPaused: false,
      closeToTray: false,
      onAction: (a) => actions.push(a),
    });
    assert.equal(template[0]?.label, "No agents running");
    assert.isTrue(
      template.some((item) => item.label === "Enable background service"),
      "should show Enable when disabled",
    );
    assert.isTrue(template.some((item) => item.label === "Show T3 Code"));
    assert.isTrue(template.some((item) => item.label === "Quit"));
  });

  it("shows running count and pause toggle", () => {
    const template = DesktopTray.buildTrayMenuTemplate({
      runningCount: 3,
      agentsPaused: false,
      closeToTray: true,
      onAction: () => undefined,
    });
    assert.equal(template[0]?.label, "3 agents running");
    assert.isTrue(template.some((item) => item.label === "Pause agents"));
    assert.isTrue(template.some((item) => item.label === "Disable background service"));
  });

  it("shows paused state", () => {
    const template = DesktopTray.buildTrayMenuTemplate({
      runningCount: 2,
      agentsPaused: true,
      closeToTray: true,
      onAction: () => undefined,
    });
    assert.equal(template[0]?.label, "Agents paused");
    assert.isTrue(template.some((item) => item.label === "Resume agents"));
  });

  it("fires onAction for show and quit", () => {
    const actions: DesktopTray.DesktopTrayMenuAction[] = [];
    const template = DesktopTray.buildTrayMenuTemplate({
      runningCount: 0,
      agentsPaused: false,
      closeToTray: true,
      onAction: (a) => actions.push(a),
    });
    const show = template.find((i) => i.label === "Show T3 Code");
    const quit = template.find((i) => i.label === "Quit");
    (show as { click?: () => void })?.click?.();
    (quit as { click?: () => void })?.click?.();
    assert.deepEqual(actions, ["show", "quit"]);
  });
});
