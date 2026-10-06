import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  type Context,
  createElement,
  type FunctionComponent,
  type ReactElement,
} from "react";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const routeCode = transpileModule(
  `${readFileSync(new URL("../../App.tsx", import.meta.url), "utf8")}\nexport { RecordingRoute, SessionContext };`,
  {
    fileName: "App.tsx",
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  },
).outputText;

function recordingHarness({ clips = 0, saveSucceeds = true } = {}) {
  let busy = false;
  let removed = false;
  let leaveCalls = 0;
  let drafts = [
    { id: "draft-a", status: "local", clips: Array(clips).fill({}) },
  ];
  let onBack: () => void;
  let guard: {
    enabled: boolean;
    callback: (event: { data: { action: object } }) => void;
  };
  let preventedAction: object | undefined;
  let releaseSave: () => void = () => {};
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const navigation = {
    goBack() {
      if (guard.enabled) {
        preventedAction = { type: "GO_BACK" };
        guard.callback({ data: { action: preventedAction } });
      } else removed = true;
    },
    dispatch(action: object) {
      // React Navigation allows the originally intercepted action on redispatch.
      assert.equal(action, preventedAction);
      removed = true;
    },
  };
  const exports: {
    RecordingRoute?: FunctionComponent<{
      route: { params: { draftId: string } };
      navigation: typeof navigation;
    }>;
    SessionContext?: Context<unknown>;
  } = {};
  runInNewContext(routeCode, {
    exports,
    require(name: string) {
      if (name === "react" || name === "react/jsx-runtime")
        return require(name);
      if (name === "react-native")
        return { StyleSheet: { create: (styles: object) => styles } };
      if (name === "@react-navigation/native")
        return {
          DefaultTheme: { colors: {} },
          createNavigationContainerRef: () => ({}),
          usePreventRemove: (
            enabled: boolean,
            callback: typeof guard.callback,
          ) => {
            guard = { enabled, callback };
          },
        };
      if (name === "@react-navigation/native-stack")
        return { createNativeStackNavigator: () => ({}) };
      if (name === "./src/screens/RecordingScreen")
        return {
          RecordingScreen(props: { onBack: () => void }) {
            onBack = props.onBack;
            return createElement("div", null, "recording");
          },
        };
      return {};
    },
  });
  const { RecordingRoute, SessionContext } = exports;
  assert.ok(RecordingRoute && SessionContext);
  const Recording = RecordingRoute;
  const ControllerProvider = SessionContext.Provider;
  async function leave() {
    leaveCalls++;
    busy = true;
    if (saveSucceeds && !clips) drafts = [];
    render();
    await saving;
    busy = false;
    // A navigation action can run before React commits the idle state.
    return saveSucceeds;
  }
  function render() {
    return renderToStaticMarkup(
      createElement(
        ControllerProvider,
        {
          value: {
            state: { drafts, pendingRecording: null },
            recorder: { recorderState: "off", elapsedMs: 0 },
            busy,
            leave,
          },
        },
        createElement(Recording, {
          route: { params: { draftId: "draft-a" } },
          navigation,
        }),
      ),
    );
  }
  render();
  return {
    toolbarBack: () => onBack(),
    systemBack: () => navigation.goBack(),
    releaseSave,
    get removed() {
      return removed;
    },
    get leaveCalls() {
      return leaveCalls;
    },
    get drafts() {
      return drafts;
    },
  };
}

test("toolbar back still leaves the recording route after an empty draft disappears during save", async () => {
  const app = recordingHarness();
  app.toolbarBack();
  assert.equal(app.removed, false);
  app.releaseSave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.removed, true);
  assert.equal(app.leaveCalls, 1);
  assert.equal(app.drafts.length, 0);
});

test("system back cleans up an idle recording before removing its route", async () => {
  const app = recordingHarness();
  app.systemBack();
  assert.equal(app.removed, false);
  app.releaseSave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.removed, true);
  assert.equal(app.leaveCalls, 1);
  assert.equal(app.drafts.length, 0);
});

test("back preserves saved clips and does not remove the route when saving fails", async () => {
  for (const saveSucceeds of [true, false]) {
    const app = recordingHarness({ clips: 1, saveSucceeds });
    app.toolbarBack();
    app.releaseSave();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(app.removed, saveSucceeds);
    assert.equal(app.drafts[0].clips.length, 1);
    assert.equal(app.leaveCalls, 1);
  }
});
