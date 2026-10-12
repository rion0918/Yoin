import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type FunctionComponent } from "react";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { figmaColors } from "../design/figma.ts";
import { colors, radii } from "../design/tokens.ts";

const require = createRequire(import.meta.url);
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
  let contextValue: unknown;
  let currentHook = 0;
  const refs: { current: unknown }[] = [];
  let effect: (() => void) | undefined;
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
  } = {};
  runInNewContext(routeCode, {
    exports,
    require(name: string) {
      if (name === "react")
        return {
          ...require(name),
          useCallback: (callback: (...args: never[]) => unknown) => callback,
          useContext: () => contextValue,
          useEffect: (callback: () => void) => {
            effect = callback;
          },
          useRef: (initial: unknown) => {
            const index = currentHook++;
            refs[index] ??= { current: initial };
            return refs[index];
          },
        };
      if (name === "react/jsx-runtime") return require(name);
      if (name === "react-native")
        return { StyleSheet: { create: (styles: object) => styles } };
      if (name === "./src/design/tokens") return { colors, radii };
      if (name === "./src/design/figma") return { figmaColors };
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
  const { RecordingRoute } = exports;
  assert.ok(RecordingRoute);
  const Recording = RecordingRoute;
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
    currentHook = 0;
    contextValue = {
      state: { drafts, pendingRecording: null },
      recorder: { recorderState: "off", elapsedMs: 0 },
      busy,
      leave,
    };
    const screen = Recording({
      route: { params: { draftId: "draft-a" } },
      navigation,
    }) as { type?: unknown; props?: { onBack: () => void } };
    if (typeof screen?.type === "function" && screen.props)
      (screen.type as (props: { onBack: () => void }) => unknown)(screen.props);
  }
  render();
  return {
    toolbarBack: () => onBack(),
    systemBack: () => navigation.goBack(),
    flushEffect: () => effect?.(),
    setBusy(value: boolean) {
      busy = value;
      render();
    },
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

test("system back pressed while busy is replayed after the operation finishes", async () => {
  const app = recordingHarness();
  app.setBusy(true);
  app.systemBack();
  assert.equal(app.removed, false);
  assert.equal(app.leaveCalls, 0);

  app.setBusy(false);
  app.flushEffect();
  assert.equal(app.removed, false);
  assert.equal(app.leaveCalls, 1);

  app.releaseSave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.removed, true);
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
