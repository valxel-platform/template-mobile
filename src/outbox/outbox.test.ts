import { Offline, UpgradeRequired } from "../api/http";
import { SignedOut } from "../auth/session";
import { scriptedHttp } from "../test/fakes";
import { memoryStore, Outbox, type NewCommand } from "./outbox";

const change = (record: string, label = record): NewCommand => ({
  method: "PUT",
  path: `/api/v1/${record}`,
  body: { label },
  record,
  label,
});

function setup(...answers: Parameters<typeof scriptedHttp>) {
  let clock = 1_000;
  let n = 0;
  const store = memoryStore();
  const http = scriptedHttp(...answers);
  const outbox = new Outbox(store, http, {
    uuid: () => `c${String(++n)}`,
    now: () => clock,
    random: () => 0.5,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
  });
  return { store, http, outbox, tick: (ms: number) => (clock += ms) };
}

/** Enqueue without the automatic send, to control rounds in the test. */
async function queue(outbox: Outbox, ...changes: NewCommand[]) {
  for (const c of changes) {
    await outbox.enqueue(c);
    await outbox.idle();
  }
}

describe("Outbox", () => {
  it("sends a change with its id as the Idempotency-Key and forgets it once accepted", async () => {
    const { outbox, http, store } = setup({ status: 202, body: {} });
    await outbox.enqueue(change("greetings/ada"));
    await outbox.flush();
    expect(http.requests[0]).toMatchObject({
      method: "PUT",
      path: "/api/v1/greetings/ada",
      idempotencyKey: "c1",
    });
    expect(store.commands.size).toBe(0);
  });

  it("keeps changes with no signal, retries with backoff and sends them in order", async () => {
    const { outbox, http, tick } = setup(new Offline());
    await queue(outbox, change("greetings/ada", "first"));
    let [waiting] = await outbox.list();
    expect(waiting).toMatchObject({ state: "pending", attempts: 1 });
    // backoff: 1000 ms, half of it jittered (random 0.5): 750 ms
    expect(waiting?.nextAttemptAt).toBe(1_750);

    await queue(outbox, change("greetings/ada", "second")); // waits behind the first
    expect(http.requests).toHaveLength(1);
    tick(800);
    const result = await outbox.flush();
    expect(result).toEqual({ sent: 2, waiting: 0, stopped: null });
    expect(http.requests.map((r) => (r.body as { label: string }).label)).toEqual([
      "first",
      "first",
      "second",
    ]);
    [waiting] = await outbox.list();
    expect(waiting).toBeUndefined();
  });

  it("retries a 503 later without holding up other records", async () => {
    const { outbox, http } = setup(
      { status: 503, body: { title: "Service Unavailable" } },
      { status: 202, body: {} },
    );
    await outbox.enqueue(change("greetings/ada"));
    await outbox.enqueue(change("greetings/bob"));
    await outbox.flush();
    const [ada] = await outbox.list();
    expect(ada).toMatchObject({ record: "greetings/ada", state: "pending", lastStatus: 503 });
    expect(http.requests.map((r) => r.path)).toContain("/api/v1/greetings/bob");
  });

  it("keeps a conflict for the person and holds later changes to the record", async () => {
    const { outbox, http } = setup({
      status: 409,
      body: { title: "Conflict", detail: "Changed by someone else" },
    });
    await queue(outbox, change("greetings/ada", "first"), change("greetings/ada", "second"));
    const [first, second] = await outbox.list();
    expect(first).toMatchObject({ state: "conflict", problem: "Changed by someone else" });
    expect(second?.state).toBe("pending");
    expect(http.requests).toHaveLength(1);

    await outbox.discard(first?.id ?? "");
    await outbox.flush();
    expect(await outbox.list()).toEqual([]);
  });

  it("marks other 4xx as rejected, and sends it again when the person asks", async () => {
    const { outbox, http } = setup(
      { status: 422, body: { title: "Unprocessable" } },
      { status: 202, body: {} },
    );
    await queue(outbox, change("greetings/ada"));
    const [rejected] = await outbox.list();
    expect(rejected).toMatchObject({ state: "rejected", problem: "Unprocessable", lastStatus: 422 });
    await outbox.retry(rejected?.id ?? "");
    await outbox.flush();
    expect(http.requests).toHaveLength(2);
    expect(await outbox.list()).toEqual([]);
    await outbox.retry("gone"); // nothing to do
  });

  it.each([
    [new SignedOut(), "signedOut"],
    [new UpgradeRequired(), "upgrade"],
    [new Error("Keycloak unreachable"), "offline"],
  ])("stops the round on %s and keeps the change", async (error, stopped) => {
    const { outbox, store, http } = setup(error);
    await store.put({
      ...change("x"),
      id: "x",
      createdAt: 0,
      attempts: 0,
      nextAttemptAt: 0,
      state: "pending",
    });
    await store.put({
      ...change("y"),
      id: "y",
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0,
      state: "pending",
    });
    expect(await outbox.flush()).toEqual({ sent: 0, waiting: 2, stopped });
    expect(http.requests).toHaveLength(1);
  });

  it("stops on a 401 the refresh couldn't fix", async () => {
    const { outbox, store } = setup({ status: 401, body: null });
    await store.put({
      ...change("x"),
      id: "x",
      createdAt: 0,
      attempts: 0,
      nextAttemptAt: 0,
      state: "pending",
    });
    expect(await outbox.flush()).toEqual({ sent: 0, waiting: 1, stopped: "signedOut" });
  });

  it("caps the backoff", async () => {
    const { outbox, store } = setup(new Offline());
    await store.put({
      ...change("x"),
      id: "x",
      createdAt: 0,
      attempts: 9,
      nextAttemptAt: 0,
      state: "pending",
    });
    await outbox.flush();
    expect((await outbox.list())[0]?.nextAttemptAt).toBe(1_000 + 6_000);
  });

  it("runs one round at a time and another for changes made meanwhile", async () => {
    let release: () => void = () => undefined;
    const requests: string[] = [];
    const http = {
      send: (r: { path: string }) => {
        requests.push(r.path);
        return new Promise<{ status: number; body: null }>((resolve) => {
          release = () => resolve({ status: 202, body: null });
        });
      },
    };
    let n = 0;
    const outbox = new Outbox(memoryStore(), http, { uuid: () => `c${String(++n)}` });
    const listener = jest.fn();
    outbox.subscribe(listener);
    await outbox.enqueue(change("a"));
    await outbox.enqueue(change("b")); // joins the running round, which already listed its commands
    expect(requests).toEqual(["/api/v1/a"]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toEqual(["/api/v1/a", "/api/v1/b"]);
    expect(listener).toHaveBeenCalled();
  });

  it("forgets everything on clear", async () => {
    const { outbox } = setup(new Offline());
    await queue(outbox, change("a"));
    await outbox.clear();
    expect(await outbox.list()).toEqual([]);
  });
});
