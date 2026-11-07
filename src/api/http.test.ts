import { SignedOut } from "../auth/session";
import {
  ApiError,
  createHttp,
  Offline,
  traceIdOf,
  traceparent,
  UpgradeRequired,
  type HttpOptions,
} from "./http";

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/problem+json" },
  });
}

function setup(answers: (Response | Error)[], overrides: Partial<HttpOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift() ?? response(200, {});
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const session = {
    accessToken: jest.fn(() => Promise.resolve("access-1")),
    refresh: jest.fn(() => Promise.resolve({ accessToken: "access-2", expiresAt: 0 })),
  };
  const onUpgradeRequired = jest.fn();
  const http = createHttp({
    base: "https://example.vrixel.com/mobile",
    session,
    appVersion: "1.4.0",
    platform: "ios",
    fetch: fetchImpl as unknown as typeof fetch,
    randomBytes: (n) => new Uint8Array(n).fill(171),
    onUpgradeRequired,
    ...overrides,
  });
  const header = (i: number, name: string) => (calls[i]?.init.headers as Record<string, string>)[name];
  return { http, calls, session, onUpgradeRequired, header };
}

describe("createHttp", () => {
  it("sends the token, the app's version and a new trace with every request", async () => {
    const { http, calls, header } = setup([response(202, { eventId: "e1", status: "accepted" })]);
    const res = await http.send({
      method: "PUT",
      path: "/api/v1/greetings/ada",
      body: { name: "Ada" },
      idempotencyKey: "k1",
    });
    expect(res).toMatchObject({ status: 202, body: { eventId: "e1", status: "accepted" } });
    // No traceresponse: the trace is the one this app started.
    expect(traceIdOf(header(0, "traceparent"))).toBe(res.traceId);
    expect(calls[0]?.url).toBe("https://example.vrixel.com/mobile/api/v1/greetings/ada");
    expect(calls[0]?.init.body).toBe('{"name":"Ada"}');
    expect(header(0, "Authorization")).toBe("Bearer access-1");
    expect(header(0, "X-App-Version")).toBe("1.4.0");
    expect(header(0, "X-App-Platform")).toBe("ios");
    expect(header(0, "Idempotency-Key")).toBe("k1");
    expect(header(0, "Content-Type")).toBe("application/json");
    expect(header(0, "traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("refreshes once on a 401 and retries", async () => {
    const { http, session, header } = setup([response(401), response(200, { message: "hi" })]);
    expect((await http.send({ method: "GET", path: "/api/v1/greetings?name=a" })).status).toBe(200);
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(header(1, "Authorization")).toBe("Bearer access-2");
    expect(header(1, "Content-Type")).toBeUndefined();
  });

  it("passes on SignedOut when the refresh is refused", async () => {
    const { http, session } = setup([response(401)]);
    session.refresh.mockRejectedValueOnce(new SignedOut());
    await expect(http.send({ method: "GET", path: "/x" })).rejects.toThrow(SignedOut);
  });

  it("tells gradual releases about server failures and no answer, not the person's mistakes", async () => {
    const onFailure = jest.fn();
    const { http } = setup([response(503), response(400), new TypeError("no signal")], { onFailure });
    await http.send({ method: "GET", path: "/api/v1/greetings" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    await http.send({ method: "GET", path: "/api/v1/greetings" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    await expect(http.send({ method: "GET", path: "/api/v1/greetings" })).rejects.toBeInstanceOf(Offline);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it("reports no signal as Offline", async () => {
    const { http } = setup([new TypeError("Network request failed")]);
    await expect(http.send({ method: "GET", path: "/x" })).rejects.toThrow(Offline);
  });

  it("gives up after its timeout", async () => {
    jest.useFakeTimers();
    try {
      const hanging = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      );
      const { http } = setup([], { fetch: hanging as unknown as typeof fetch, timeoutMs: 100 });
      const sent = http.send({ method: "GET", path: "/x" });
      const failed = expect(sent).rejects.toThrow(Offline);
      await jest.advanceTimersByTimeAsync(150);
      await failed;
    } finally {
      jest.useRealTimers();
    }
  });

  it("tells the app when this version is too old", async () => {
    const { http, onUpgradeRequired } = setup([response(426, { title: "Upgrade Required" })]);
    await expect(http.send({ method: "GET", path: "/x" })).rejects.toThrow(UpgradeRequired);
    expect(onUpgradeRequired).toHaveBeenCalled();
  });

  it("reads non-JSON answers as no body", async () => {
    const { http } = setup([
      new Response("oops", { status: 502, headers: { "content-type": "text/plain" } }),
    ]);
    expect(await http.send({ method: "GET", path: "/x" })).toMatchObject({ status: 502, body: null });
  });

  it("keeps the trace the API names, for error reports", async () => {
    const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const { http } = setup([
      new Response("{}", {
        status: 503,
        headers: { "content-type": "application/json", traceresponse: `00-${trace}-00f067aa0ba902b7-01` },
      }),
    ]);
    const res = await http.send({ method: "GET", path: "/x" });
    expect(res.traceId).toBe(trace);
    expect(ApiError.from(res, "GET /x")).toMatchObject({ status: 503, endpoint: "GET /x", traceId: trace });
    expect(traceIdOf("junk")).toBe("");
  });
});

describe("ApiError", () => {
  it("uses the problem's title and detail", () => {
    expect(
      ApiError.from({ status: 400, body: { title: "Bad Request", detail: "name is blank" } }).message,
    ).toBe("API 400: name is blank");
    expect(ApiError.from({ status: 500, body: null }).title).toBe("HTTP 500");
  });
});

describe("traceparent", () => {
  it("is W3C trace context", () => {
    expect(traceparent((n) => new Uint8Array(n))).toBe(`00-${"0".repeat(32)}-${"0".repeat(16)}-01`);
  });
});
