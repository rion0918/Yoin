import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { figmaColors } from "../design/figma.ts";
import { colors, layout, radii } from "../design/tokens.ts";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: ReactNode) => string;
};
type Button = {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
  testID?: string;
};

function loginHarness(
  { ready = true, busy = false, error = null } = {} as {
    ready?: boolean;
    busy?: boolean;
    error?: string | null;
  },
) {
  const buttons = new Map<string, Button>();
  const images: {
    accessible?: boolean;
    accessibilityLabel?: string;
    source: string;
    style?: { width: string; height: string; left: string; top: string };
  }[] = [];
  const opened: string[] = [];
  let signIns = 0;
  function Container({ children }: { children: ReactNode }) {
    return createElement("div", null, children);
  }
  function load(path: string): Record<string, FunctionComponent> {
    const output = transpileModule(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      {
        compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
      },
    ).outputText;
    const exports = {};
    runInNewContext(output, {
      exports,
      require(name: string) {
        if (name === "react" || name === "react/jsx-runtime")
          return require(name);
        if (name === "react-native")
          return {
            View: Container,
            ScrollView: Container,
            Text: ({
              children,
              accessibilityLiveRegion,
            }: {
              children: ReactNode;
              accessibilityLiveRegion?: "polite";
            }) =>
              createElement(
                "span",
                { "aria-live": accessibilityLiveRegion },
                children,
              ),
            Image: (props: {
              accessible?: boolean;
              accessibilityLabel?: string;
              source: string;
            }) => {
              images.push(props);
              return null;
            },
            ActivityIndicator: () => null,
            StyleSheet: {
              create: (styles: object) => styles,
              absoluteFill: {},
            },
            useWindowDimensions: () => ({
              width: 390,
              height: 840,
              fontScale: 1,
            }),
            Linking: {
              openURL: async (url: string) => {
                opened.push(url);
              },
            },
          };
        if (name === "react-native-safe-area-context")
          return {
            SafeAreaProvider: Container,
            useSafeAreaInsets: () => ({
              top: 44,
              bottom: 34,
              left: 0,
              right: 0,
            }),
          };
        if (name.endsWith("/useAuthentication"))
          return {
            useAuthentication: () => ({
              identity: null,
              ready,
              busy,
              error,
              signIn: async () => {
                signIns++;
              },
            }),
          };
        if (name.endsWith("/LoginScreen"))
          return load("../screens/LoginScreen.tsx");
        if (name.endsWith("/YoinLogo"))
          return load("../components/YoinLogo.tsx");
        if (name.endsWith("/ActionButton"))
          return {
            ActionButton: (props: Button) => {
              if (props.testID) buttons.set(props.testID, props);
              return createElement(
                "button",
                { type: "button", disabled: props.disabled },
                props.children,
              );
            },
          };
        if (name.endsWith("/tokens")) return { colors, layout, radii };
        if (name.endsWith("/figma")) return { figmaColors };
        if (name.endsWith(".png")) return name;
        if (name === "expo-status-bar") return { StatusBar: () => null };
        if (name === "@react-navigation/native")
          return {
            DefaultTheme: { colors: {} },
            createNavigationContainerRef: () => ({}),
          };
        if (name === "@react-navigation/native-stack")
          return { createNativeStackNavigator: () => ({}) };
        return {};
      },
    });
    return exports;
  }
  const App = load("../../App.tsx").default;
  const html = renderToStaticMarkup(createElement(App));
  return {
    html,
    images,
    buttons,
    opened,
    get signIns() {
      return signIns;
    },
    press(id: string) {
      const button = buttons.get(id);
      assert.ok(button, `${id} is visible`);
      if (!button.disabled) button.onPress();
    },
  };
}

test("the login action remains visible and disabled while checking authentication", () => {
  const app = loginHarness({ ready: false });
  assert.equal(app.buttons.get("google-login")?.disabled, true);
  assert.match(app.html, /ログインを確認中/);
  app.press("google-login");
  assert.equal(app.signIns, 0);
  assert.ok(app.buttons.has("privacy-policy"));
});

test("Google login is enabled when ready and indicates pending sign-in without a second action", () => {
  const idle = loginHarness();
  idle.press("google-login");
  assert.equal(idle.signIns, 1);
  const pending = loginHarness({ busy: true });
  assert.match(pending.html, /ログイン中/);
  pending.press("google-login");
  assert.equal(pending.signIns, 0);
  assert.ok(pending.buttons.has("privacy-policy"));
});

test("a sign-in error is announced and leaves login and the existing privacy policy available", () => {
  const message =
    "ログインを確認できませんでした。通信を確認して、もう一度お試しください。";
  const app = loginHarness({ error: message });
  assert.match(app.html, /aria-live="polite"/);
  assert.ok(app.html.includes(message));
  app.press("google-login");
  app.press("privacy-policy");
  assert.equal(app.signIns, 1);
  assert.deepEqual(app.opened, [
    "https://yoin-private-api.h-rion-0910.workers.dev/privacy",
  ]);
});

test("the supplied login artwork is decorative and the existing welcome copy is preserved", () => {
  const app = loginHarness();
  assert.ok(
    app.images.some(
      (image) =>
        image.source.endsWith("loginhome.png") && image.accessible === false,
    ),
  );
  assert.match(app.html, /写真にはない、/);
  assert.match(app.html, /あの日のこと。/);
  assert.match(app.html.replace(/\s+/g, ""), /会話を、思い出の一曲に。/);
});

test("the supplied logo replaces the text wordmark and is announced as Yoin", () => {
  const app = loginHarness();
  assert.ok(
    app.images.some(
      (image) =>
        image.source.endsWith("yoinlogo.png") &&
        image.accessible === true &&
        image.accessibilityLabel === "Yoin",
    ),
  );
  assert.doesNotMatch(app.html, />Yoin</);
});

test("the black-edged logo fits the frame including the rightmost music note", () => {
  const app = loginHarness();
  const style = app.images.find((image) =>
    image.source.endsWith("yoinlogo.png"),
  )?.style;
  assert.ok(style);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  const left = Number.parseFloat(style.left);
  const top = Number.parseFloat(style.top);
  // Visible bounds of the supplied 2172 x 724 PNG, excluding faint alpha noise.
  assert.ok(left + (381 / 2172) * width >= 0);
  assert.ok(left + (1932 / 2172) * width <= 100);
  assert.ok(top + (61 / 724) * height >= 0);
  assert.ok(top + (654 / 724) * height <= 100);
});
