import { OpenFeature, TypedInMemoryProvider } from "@openfeature/web-sdk";
import type { ApiRequest, Http } from "./api/http";
import { FlagCohorts, cohortHook, failedResponse, startCohorts } from "./cohorts";

const KEY = "medspa.ms-feat-3.check-in-kiosk";

afterEach(async () => {
  await OpenFeature.clearProviders();
  OpenFeature.clearHooks();
  jest.useRealTimers();
});

it("counts each minute once for every flag in use, on the side this install got", () => {
  const c = new FlagCohorts();
  c.touch();
  expect(c.take()).toBeNull(); // no flag used yet
  c.see(KEY, true);
  c.see("other.flag", false);
  c.see("not a key!", true);
  expect(c.take()).toBeNull(); // in the background, nothing failed
  c.touch();
  expect(c.take()).toEqual({
    flags: { [KEY]: { on: { requests: 1, errors: 0 } }, "other.flag": { off: { requests: 1, errors: 0 } } },
  });
  c.fail();
  c.see(KEY, false);
  expect(c.take()).toEqual({
    flags: { [KEY]: { off: { requests: 1, errors: 1 } }, "other.flag": { off: { requests: 1, errors: 1 } } },
  });
});

it("keeps to the number of flags the BFF accepts", () => {
  const c = new FlagCohorts();
  for (let i = 0; i < 60; i++) c.see(`f${String(i)}`, true);
  c.see("f1", false);
  c.touch();
  const flags = c.take()?.flags ?? {};
  expect(Object.keys(flags)).toHaveLength(50);
  expect(flags.f1).toEqual({ off: { requests: 1, errors: 0 } });
});

it("counts every boolean flag the app reads and tells error reporting", async () => {
  const c = new FlagCohorts();
  const noted: [string, boolean][] = [];
  OpenFeature.addHooks(cohortHook(c, (k, on) => noted.push([k, on])));
  await OpenFeature.setProviderAndWait(
    new TypedInMemoryProvider({
      [KEY]: { variants: { on: true, off: false }, defaultVariant: "on", disabled: false },
      colour: { variants: { a: "blue" }, defaultVariant: "a", disabled: false },
    }),
  );
  const client = OpenFeature.getClient();
  expect(client.getBooleanValue(KEY, false)).toBe(true);
  expect(client.getStringValue("colour", "red")).toBe("blue");
  expect(noted).toEqual([[KEY, true]]);
  c.touch();
  expect(c.take()).toEqual({ flags: { [KEY]: { on: { requests: 1, errors: 0 } } } });
});

it("counts server failures, not the person's mistakes", () => {
  expect(failedResponse(502)).toBe(true);
  expect(failedResponse(422)).toBe(false);
});

it("posts each minute's counts through the BFF's mobile route; uncaught errors count", () => {
  jest.useFakeTimers();
  const c = new FlagCohorts();
  const sent: ApiRequest[] = [];
  const http: Http = {
    send: (r) => {
      sent.push(r);
      return Promise.reject(new Error("signed out"));
    },
  };
  let handler: (e: unknown, fatal?: boolean) => void = () => undefined;
  const previous = jest.fn();
  const errorUtils = {
    getGlobalHandler: () => previous,
    setGlobalHandler: (h: typeof handler) => {
      handler = h;
    },
  };
  let foreground = true;
  const stop = startCohorts({ http, counter: c, foreground: () => foreground, errorUtils });
  jest.advanceTimersByTime(60_000);
  expect(sent).toEqual([]); // no flag used yet
  c.see(KEY, true);
  handler(new Error("boom"), false);
  expect(previous).toHaveBeenCalledWith(expect.any(Error), false); // the usual handling still runs
  jest.advanceTimersByTime(60_000);
  expect(sent).toEqual([
    { method: "POST", path: "/flag-cohorts", body: { flags: { [KEY]: { on: { requests: 1, errors: 1 } } } } },
  ]);
  foreground = false;
  jest.advanceTimersByTime(60_000);
  expect(sent).toHaveLength(1); // in the background: not a minute of use
  stop();
  startCohorts({ http, counter: c, foreground: () => true })(); // without ErrorUtils too
});
