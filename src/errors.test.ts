import type { ReactNativeOptions } from "@sentry/react-native";
import * as Sentry from "@sentry/react-native";
import { ApiError } from "./api/http";
import { noteFlag, reportError, scrub, scrubTransaction, startErrors } from "./errors";
import { config } from "./test/fakes";

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  featureFlagsIntegration: () => ({ name: "FeatureFlags" }),
  getClient: () => undefined,
}));

type Event = Parameters<typeof scrub>[0];
const fakeSentry = () => ({ init: jest.fn<undefined, [ReactNativeOptions]>() });
const dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42";

it("stays off without a DSN", () => {
  const sentry = fakeSentry();
  expect(startErrors(config, sentry)).toBe(false);
  expect(sentry.init).not.toHaveBeenCalled();
});

it("with a DSN, reports errors and sessions but no screenshots, views or people", () => {
  const sentry = fakeSentry();
  expect(startErrors({ ...config, sentryDsn: dsn, env: "production" }, sentry)).toBe(true);
  const opts = sentry.init.mock.calls[0]![0];
  expect(opts).toMatchObject({
    dsn,
    environment: "production",
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    integrations: [{ name: "FeatureFlags" }], // each event names the flags and their values
  });
  const sent = opts.beforeSend!({ type: undefined, message: "x", user: { id: "1" } }, {});
  expect(sent).toEqual({ type: undefined, breadcrumbs: [], logentry: undefined });
});

it("keeps an error's type and stack and drops what a person typed or who they are", () => {
  const event = {
    type: undefined,
    message: "Saved Jane Doe",
    user: { email: "jane@example.com" },
    extra: { form: { name: "Jane" } },
    request: { url: "https://app.example.com/mobile/api/patients?name=Jane#top" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read 'Jane' of undefined",
          stacktrace: { frames: [{ function: "save", lineno: 3, vars: { name: "Jane" } }] },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: "Jane", timestamp: 1 },
      { category: "touch", message: "Button 'Save Jane'", timestamp: 2 },
      { category: "navigation", timestamp: 3, data: { from: "/patients/Jane", to: "/patients?q=Jane" } },
      {
        category: "xhr",
        type: "http",
        timestamp: 4,
        data: { url: "/mobile/api/x?q=Jane", method: "GET", status_code: 500 },
      },
      { category: "app.lifecycle", timestamp: 5 },
    ],
  } as unknown as Event;
  const out = scrub(event);
  expect(out.exception?.values?.[0]).toEqual({
    type: "TypeError",
    value: undefined,
    stacktrace: { frames: [{ function: "save", lineno: 3 }] },
  });
  expect(out.request).toEqual({ url: "https://app.example.com/mobile/api/patients" });
  expect(out.breadcrumbs?.map((b) => b.category)).toEqual(["navigation", "xhr", "app.lifecycle"]);
  expect(out.breadcrumbs?.[1]?.data).toEqual({
    url: "/mobile/api/x",
    to: undefined,
    method: "GET",
    status_code: 500,
  });
  expect(out.breadcrumbs?.[2]?.data).toBeUndefined();
  // A route's path segments can still name someone: keep identifiers, not names, in routes.
  expect(JSON.stringify({ ...out, breadcrumbs: [] })).not.toContain("Jane");
  expect(JSON.stringify(out.breadcrumbs?.[1])).not.toContain("Jane");
});

it("ties a failed API call's report to the backend's trace", () => {
  const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
  const err = new ApiError(503, "Unavailable", undefined, "GET /api/v1/greetings", trace);
  const out = scrub({ type: undefined, tags: { a: "b" } }, { originalException: err });
  expect(out.tags).toEqual({ a: "b", trace_id: trace, endpoint: "GET /api/v1/greetings", status: "503" });
  expect(scrub({ type: undefined }, { originalException: new ApiError(500, "x") }).tags).toEqual({
    status: "500",
  });
  reportError(err);
  expect(Sentry.captureException).toHaveBeenCalledWith(err);
});

it("names each evaluated flag on later error events, while reporting is on", () => {
  const addFeatureFlag = jest.fn();
  const getIntegrationByName = jest.fn(() => ({ addFeatureFlag }));
  noteFlag("ms.ms-feat-3.kiosk", true, { getClient: () => ({ getIntegrationByName }) } as never);
  expect(getIntegrationByName).toHaveBeenCalledWith("FeatureFlags");
  expect(addFeatureFlag).toHaveBeenCalledWith("ms.ms-feat-3.kiosk", true);
  expect(() => noteFlag("ms.x", false)).not.toThrow(); // reporting off: nothing to tell
});

it("sends performance data for a share of sessions, with paths only", () => {
  const sentry = fakeSentry();
  startErrors({ ...config, sentryDsn: dsn, sentryTracesSampleRate: 0.05 }, sentry);
  const opts = sentry.init.mock.calls[0]![0];
  expect(opts.tracesSampleRate).toBe(0.05);
  const tx = scrubTransaction({
    type: "transaction",
    user: { id: "u-1" },
    request: { url: "https://app.example.com/mobile/api/patients?name=Jane" },
    spans: [
      {
        span_id: "a",
        trace_id: "b",
        start_timestamp: 1,
        description: "GET https://app.example.com/mobile/api/patients?name=Jane",
        data: { url: "https://app.example.com/mobile/api/patients?name=Jane", "http.query": "name=Jane" },
      },
    ],
  });
  expect(JSON.stringify(tx)).not.toContain("Jane");
  expect(tx.user).toBeUndefined();
  expect(tx.spans?.[0]?.description).toBe("GET https://app.example.com/mobile/api/patients");
});
