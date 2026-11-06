import { OpenFeature, OpenFeatureProvider, TypedInMemoryProvider } from "@openfeature/react-sdk";
import { render, screen, waitFor } from "@testing-library/react-native";
import * as ScreenCapture from "expo-screen-capture";
import { Text } from "react-native";
import { flagProvider, startFlags, useFeature } from "./flags";
import { protectScreens } from "./privacy";
import { Body, Notice, Title } from "./ui/components";

jest.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  enableAppSwitcherProtectionAsync: jest.fn(() => Promise.resolve()),
}));

describe("protectScreens", () => {
  it("blocks screenshots and hides the app switcher preview for PHI apps only", async () => {
    await protectScreens(false);
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    await protectScreens(true);
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith("phi");
    expect(ScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalled();
  });

  it("carries on where the platform can't", async () => {
    jest.mocked(ScreenCapture.preventScreenCaptureAsync).mockRejectedValueOnce(new Error("unavailable"));
    await expect(protectScreens(true)).resolves.toBeUndefined();
  });
});

function Kiosk() {
  return <Text>{useFeature("example.ex-feat-1.kiosk") ? "kiosk" : "front desk"}</Text>;
}

describe("flags", () => {
  it("turns a feature on when its flag is on, and off by default", async () => {
    await startFlags(
      new TypedInMemoryProvider({
        "example.ex-feat-1.kiosk": {
          variants: { on: true, off: false },
          defaultVariant: "on",
          disabled: false,
        },
      }),
    );
    await render(
      <OpenFeatureProvider>
        <Kiosk />
      </OpenFeatureProvider>,
    );
    await waitFor(() => expect(screen.getByText("kiosk")).toBeOnTheScreen());
    await OpenFeature.clearProviders();
  });

  it("reads flags over OFREP from the product's origin", () => {
    expect(flagProvider("https://example.vrixel.com").metadata.name).toMatch(/Remote Evaluation/);
  });
});

describe("components", () => {
  it("renders headings and notices accessibly", async () => {
    await render(
      <>
        <Title>Title</Title>
        <Body muted>Body</Body>
        <Notice tone="warning">Careful</Notice>
      </>,
    );
    expect(screen.getByRole("header", { name: "Title" })).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toBeOnTheScreen();
  });
});
