import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Linking } from "react-native";
import { ApiError, Offline } from "../api/http";
import { AppProvider } from "../AppContext";
import type { Services } from "../services";
import { fakeServices, scriptedHttp } from "../test/fakes";
import { ChangesScreen } from "./ChangesScreen";
import { GreetingsScreen, slug } from "./GreetingsScreen";
import { SignInScreen } from "./SignInScreen";
import { UpdateScreen } from "./UpdateScreen";

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

function show(services: Services, element: ReactNode) {
  return render(<AppProvider services={services}>{element}</AppProvider>);
}

describe("GreetingsScreen", () => {
  it("shows who is signed in and reads a greeting", async () => {
    await show(await fakeServices(), <GreetingsScreen />);
    expect(screen.getByText("Signed in as Ada Lovelace")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Name"), "Ada");
    await fireEvent.press(screen.getByRole("button", { name: "Get greeting" }));
    expect(await screen.findByText("Hello, Ada!")).toBeOnTheScreen();
  });

  it.each([
    [new Offline(), "No connection. Try again when you're back online."],
    [new ApiError(403, "Forbidden", "You can't read greetings"), "You can't read greetings"],
    [new ApiError(500, "Server Error"), "Server Error"],
    [new Error("boom"), "Something went wrong."],
  ])("explains a failed read (%s)", async (error, text) => {
    await show(await fakeServices({ api: { greeting: () => Promise.reject(error) } }), <GreetingsScreen />);
    await fireEvent.changeText(screen.getByLabelText("Name"), "Ada");
    await fireEvent.press(screen.getByRole("button", { name: "Get greeting" }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it("saves a greeting offline and says it is waiting", async () => {
    const services = await fakeServices({ http: scriptedHttp(new Offline()) });
    await show(services, <GreetingsScreen />);
    await fireEvent.changeText(screen.getByLabelText("Name"), "Ada Lovelace");
    await fireEvent.changeText(screen.getByLabelText("Message"), "Hello");
    await fireEvent.press(screen.getByRole("button", { name: "Save greeting" }));
    expect(await screen.findByText("1 change waiting to send")).toBeOnTheScreen();
    const [command] = await services.outbox.list();
    expect(command).toMatchObject({
      path: "/api/v1/greetings/ada-lovelace",
      body: { name: "Ada Lovelace", message: "Hello" },
    });
  });

  it("asks for a name and message before saving", async () => {
    await show(await fakeServices(), <GreetingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Save greeting" }));
    expect(await screen.findByText("Enter a name and a message.")).toBeOnTheScreen();
  });

  it("points out changes that need attention, and signs out", async () => {
    const services = await fakeServices({ http: scriptedHttp({ status: 409, body: { title: "Conflict" } }) });
    await show(services, <GreetingsScreen />);
    await fireEvent.changeText(screen.getByLabelText("Name"), "Ada");
    await fireEvent.changeText(screen.getByLabelText("Message"), "Hi");
    await fireEvent.press(screen.getByRole("button", { name: "Save greeting" }));
    expect(await screen.findByText("1 change needs your attention")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(services.session.state).toBe("signedOut"));
    expect(await services.outbox.list()).toEqual([]);
  });
});

describe("ChangesScreen", () => {
  it("lists waiting changes and lets the person resolve a conflict", async () => {
    const services = await fakeServices({
      http: scriptedHttp(
        { status: 409, body: { title: "Conflict", detail: "Changed elsewhere" } },
        new Offline(),
      ),
    });
    await services.outbox.enqueue({
      method: "PUT",
      path: "/api/v1/greetings/ada",
      body: {},
      record: "greeting/ada",
      label: "Greeting for Ada",
    });
    await services.outbox.idle();
    await show(services, <ChangesScreen />);
    expect(await screen.findByText("Someone else changed this first.")).toBeOnTheScreen();
    expect(screen.getByText("Changed elsewhere")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByText("Waiting for a connection.")).toBeOnTheScreen();
  });

  it("discards a rejected change", async () => {
    const services = await fakeServices({ http: scriptedHttp({ status: 422, body: { title: "Invalid" } }) });
    await services.outbox.enqueue({ method: "PUT", path: "/x", record: "x", label: "Change x" });
    await services.outbox.idle();
    await show(services, <ChangesScreen />);
    expect(await screen.findByText("Not accepted.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Discard change" }));
    expect(await screen.findByText("Everything is sent.")).toBeOnTheScreen();
  });

  it("shows a change being sent", async () => {
    const services = await fakeServices({ http: { send: () => new Promise(() => undefined) } });
    await services.outbox.enqueue({ method: "PUT", path: "/x", record: "x", label: "Change x" });
    await show(services, <ChangesScreen />);
    expect(await screen.findByText("Sending…")).toBeOnTheScreen();
  });
});

describe("SignInScreen", () => {
  it("signs in, and says when sign-in didn't finish", async () => {
    const services = await fakeServices({ signedIn: false });
    const signIn = jest
      .spyOn(services.session, "signIn")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(true);
    await show(services, <SignInScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Sign-in didn't finish/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Sign-in didn't finish/)).toBeNull());
  });
});

describe("UpdateScreen", () => {
  it("opens the store", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(<UpdateScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Open the store" }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("apps.apple.com"));
  });
});

describe("slug", () => {
  it("makes a record id from a name", () => {
    expect(slug("  Zoë O'Brien ")).toBe("zoe-o-brien");
  });
});
