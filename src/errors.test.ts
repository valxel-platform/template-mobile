import type { ReactNativeOptions } from "@sentry/react-native";
import { scrub, startErrors } from "./errors";
import { config } from "./test/fakes";

jest.mock("@sentry/react-native", () => ({ init: jest.fn() }));

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
