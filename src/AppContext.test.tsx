import { act, render, renderHook } from "@testing-library/react-native";
import * as Network from "expo-network";
import type { ReactNode } from "react";
import { AppState, Text } from "react-native";
import { AppProvider, useServices, useSessionState, useUpgradeRequired } from "./AppContext";
import type { Services } from "./services";
import { fakeServices } from "./test/fakes";

jest.mock("expo-network", () => {
  const listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[] = [];
  return {
    listeners,
    addNetworkStateListener: jest.fn((listener: (typeof listeners)[number]) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    }),
  };
});

const network = Network as unknown as {
  listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[];
};

function wrapper(services: Services) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppProvider services={services}>{children}</AppProvider>;
  };
}

describe("AppProvider", () => {
  it("sends waiting changes when the device is back online or the app is in front", async () => {
    const services = await fakeServices();
    const flush = jest.spyOn(services.outbox, "flush");
    let change: (state: string) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      change = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
    await render(<Text>app</Text>, { wrapper: wrapper(services) });
    expect(flush).toHaveBeenCalledTimes(1);
    await act(() => network.listeners.forEach((l) => l({ isConnected: true, isInternetReachable: true })));
    await act(() => network.listeners.forEach((l) => l({ isConnected: false, isInternetReachable: false })));
    await act(() => change("active"));
    await act(() => change("background"));
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("doesn't try while signed out, and starts once signed in", async () => {
    const services = await fakeServices({ signedIn: false });
    const flush = jest.spyOn(services.outbox, "flush");
    const { result } = await renderHook(() => useSessionState(), { wrapper: wrapper(services) });
    expect(result.current).toBe("signedOut");
    expect(flush).not.toHaveBeenCalled();
    await act(() => services.session.signIn());
    expect(result.current).toBe("signedIn");
    expect(flush).toHaveBeenCalled();
  });

  it("tells screens when this version is too old", async () => {
    const services = await fakeServices();
    const { result } = await renderHook(() => useUpgradeRequired(), { wrapper: wrapper(services) });
    expect(result.current).toBe(false);
    await act(() => {
      services.upgrade.required = true;
      services.upgrade.listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
  });

  it("must wrap the screens", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(renderHook(() => useServices())).rejects.toThrow(/outside AppProvider/);
  });
});
