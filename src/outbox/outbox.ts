/**
 * Changes made on the device wait here until the API accepts them (offline-first).
 *
 * Each change is a command with its own id, sent as the request's Idempotency-Key. The service
 * turns it into one event (constitution VX-16) and a retry with the same key gets the same event
 * id, so a change sent twice (the answer was lost, the app was killed mid-send) is applied once.
 *
 * Sending, in the order changes were made:
 * - 2xx: done, removed.
 * - no signal, timeout, 408, 429, 5xx (503: Kafka didn't take it, nothing changed): kept and
 *   retried later with backoff. No signal stops the round; the next one starts when the device is
 *   back online or the app comes to the foreground.
 * - 409 or 412: a conflict (someone changed the record first). Kept as `conflict` for the person
 *   to resolve: retry (send it again as is) or discard. Later changes to the same record wait.
 * - other 4xx: `rejected` (invalid, or not allowed). Kept so the person sees it; later changes to
 *   the same record wait until it is discarded.
 * - 401 after a refresh, or a refused refresh: the round stops until the person signs in again.
 * - 426: the round stops until the app is updated.
 *
 * Changes to different records don't wait for each other; changes to the same record go in order.
 */
import { Offline, UpgradeRequired, type ApiRequest, type ApiResponse, type Http } from "../api/http";
import { SignedOut } from "../auth/session";

export type CommandState = "pending" | "conflict" | "rejected";

export interface Command {
  /** Also the Idempotency-Key */
  id: string;
  method: ApiRequest["method"];
  path: string;
  body?: unknown;
  /** The record it changes, e.g. greeting/ada: changes to one record are sent in order. */
  record: string;
  /** What the person sees in the list of waiting changes */
  label: string;
  /** Milliseconds since the epoch */
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: CommandState;
  lastStatus?: number;
  /** The API's problem title, for conflicts and rejections */
  problem?: string;
}

export interface OutboxStore {
  all(): Promise<Command[]>;
  put(command: Command): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type Stopped = "offline" | "signedOut" | "upgrade" | null;

export interface FlushResult {
  sent: number;
  waiting: number;
  stopped: Stopped;
}

export interface NewCommand {
  method: ApiRequest["method"];
  path: string;
  body?: unknown;
  record: string;
  label: string;
}

export interface OutboxOptions {
  now?: () => number;
  /** A new UUID (expo-crypto in the app) */
  uuid: () => string;
  /** Backoff: first retry after this, doubling to the maximum */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0 to 1, multiplied into the delay's jitter (Math.random in the app) */
  random?: () => number;
}

const RETRY = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export class Outbox {
  private flushing: Promise<FlushResult> | null = null;
  private again = false;
  private readonly listeners = new Set<(commands: Command[]) => void>();
  private readonly now: () => number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;

  constructor(
    private readonly store: OutboxStore,
    private readonly http: Http,
    private readonly options: OutboxOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    this.random = options.random ?? Math.random;
  }

  subscribe(listener: (commands: Command[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(): Promise<Command[]> {
    return order(await this.store.all());
  }

  /** Keep a change and try to send it now. */
  async enqueue(change: NewCommand): Promise<Command> {
    const now = this.now();
    const command: Command = {
      ...change,
      id: this.options.uuid(),
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      state: "pending",
    };
    await this.store.put(command);
    await this.changed();
    void this.flush().catch(() => undefined);
    return command;
  }

  /**
   * Send what is due. One round at a time: a call during a round joins it, and another round
   * follows so changes made meanwhile aren't left waiting.
   */
  flush(): Promise<FlushResult> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this.round().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        void this.flush().catch(() => undefined);
      }
    });
    return this.flushing;
  }

  /** Resolves once no round is running (none started meanwhile). */
  async idle(): Promise<void> {
    while (this.flushing) await this.flushing.catch(() => undefined);
  }

  /** Send a conflicting or rejected change again, as it is. */
  async retry(id: string): Promise<void> {
    const command = (await this.store.all()).find((c) => c.id === id);
    if (!command) return;
    await this.store.put({ ...command, state: "pending", nextAttemptAt: this.now(), problem: undefined });
    await this.changed();
    void this.flush().catch(() => undefined);
  }

  /** Give up a change (the person decided). */
  async discard(id: string): Promise<void> {
    await this.store.remove(id);
    await this.changed();
  }

  /** Forget everything (sign-out). */
  async clear(): Promise<void> {
    await this.store.clear();
    await this.changed();
  }

  private async round(): Promise<FlushResult> {
    const blocked = new Set<string>();
    let sent = 0;
    let stopped: Stopped = null;
    for (const command of await this.list()) {
      if (blocked.has(command.record)) continue;
      if (command.state !== "pending" || command.nextAttemptAt > this.now()) {
        blocked.add(command.record); // later changes to this record wait for it
        continue;
      }
      let response: ApiResponse;
      try {
        response = await this.http.send({
          method: command.method,
          path: command.path,
          body: command.body,
          idempotencyKey: command.id,
        });
      } catch (e) {
        if (e instanceof Offline) {
          await this.later(command);
          stopped = "offline";
        } else if (e instanceof SignedOut) {
          stopped = "signedOut";
        } else if (e instanceof UpgradeRequired) {
          stopped = "upgrade";
        } else {
          // Keycloak unreachable while refreshing, or anything unexpected: try again later.
          await this.later(command);
          stopped = "offline";
        }
        break;
      }
      if (response.status >= 200 && response.status < 300) {
        await this.store.remove(command.id);
        sent++;
      } else if (response.status === 401) {
        stopped = "signedOut";
        break;
      } else if (RETRY(response.status)) {
        await this.later(command, response.status);
        blocked.add(command.record);
      } else {
        const problem = (response.body ?? {}) as { title?: string; detail?: string };
        await this.store.put({
          ...command,
          state: response.status === 409 || response.status === 412 ? "conflict" : "rejected",
          attempts: command.attempts + 1,
          lastStatus: response.status,
          problem: problem.detail ?? problem.title ?? `HTTP ${String(response.status)}`,
        });
        blocked.add(command.record);
      }
    }
    await this.changed();
    return { sent, waiting: (await this.store.all()).length, stopped };
  }

  private async later(command: Command, status?: number): Promise<void> {
    const attempts = command.attempts + 1;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempts - 1));
    // Full jitter on half the delay: devices coming back online together don't retry together.
    const wait = delay / 2 + (delay / 2) * this.random();
    await this.store.put({ ...command, attempts, nextAttemptAt: this.now() + wait, lastStatus: status });
  }

  private async changed(): Promise<void> {
    if (this.listeners.size === 0) return;
    const commands = await this.list();
    this.listeners.forEach((listener) => listener(commands));
  }
}

function order(commands: Command[]): Command[] {
  return [...commands].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** For tests and previews. */
export function memoryStore(initial: Command[] = []): OutboxStore & { commands: Map<string, Command> } {
  const commands = new Map(initial.map((c) => [c.id, c]));
  return {
    commands,
    all: () => Promise.resolve([...commands.values()]),
    put: (command) => {
      commands.set(command.id, command);
      return Promise.resolve();
    },
    remove: (id) => {
      commands.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      commands.clear();
      return Promise.resolve();
    },
  };
}
