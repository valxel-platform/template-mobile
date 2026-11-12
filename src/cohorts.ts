/**
 * Users with a feature on against users with it off, while the SDLC tool releases it gradually,
 * as in the web template.
 *
 * The services count their own requests; this counts what only the app sees. Each minute in which
 * the app is in the foreground (or something failed) counts once for every flag the app has used,
 * on the side this install got, and as failed when the minute had an uncaught JavaScript error, a
 * reported error, or an API call that failed (5xx or no answer). Once a minute the counts go to
 * the BFF (`POST <origin>/mobile/flag-cohorts`, with the person's token), which adds them up for
 * everyone and logs them for the tool. Signed out, nothing is sent.
 *
 * The product events the app tracks (`track("checkin_completed")`, events.ts) ride in the same post:
 * on each side of every flag used that minute, so a gradual release can compare how often people
 * with a feature on do them, and in total, which the BFF logs for the tool's staging check.
 *
 * Only counts leave the device: flag keys, on or off, how many minutes failed, and how many times
 * each named event happened.
 */
import type { Hook } from "@openfeature/web-sdk";
import type { Http } from "./api/http";

const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_FLAGS = 50;
/** The BFF's limits for one person's minute: at most 20 event names, each counted up to 120. */
export const MAX_EVENTS = 20;
export const MAX_COUNT = 120;
export const EVENT = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

type Side = { requests: number; errors: number; events?: Record<string, number> };
export type CohortPost = {
  flags?: Record<string, { on?: Side; off?: Side }>;
  events?: Record<string, number>;
};

export class FlagCohorts {
  private readonly used = new Map<string, boolean>();
  private failed = false;
  private active = false;
  private readonly happened = new Map<string, number>();

  /** A flag was evaluated: from now on each minute counts for it, on the side it last had. */
  see(key: string, on: boolean): void {
    if (!KEY.test(key) || (!this.used.has(key) && this.used.size >= MAX_FLAGS)) return;
    this.used.set(key, on);
  }

  /** Something failed this minute. */
  fail(): void {
    this.failed = true;
  }

  /** A product event happened this minute (events.ts `track`). */
  record(event: string): void {
    if (!EVENT.test(event) || event.length > 100) return;
    if (!this.happened.has(event) && this.happened.size >= MAX_EVENTS) return;
    this.happened.set(event, Math.min(MAX_COUNT, (this.happened.get(event) ?? 0) + 1));
  }

  /** The person was using the app this minute (it was in the foreground). */
  touch(): void {
    this.active = true;
  }

  /** This minute's counts, or null when there's nothing to say; the next minute starts. */
  take(): CohortPost | null {
    const counted = this.active || this.failed;
    const errors = this.failed ? 1 : 0;
    const events = this.happened.size ? Object.fromEntries([...this.happened].sort()) : undefined;
    this.active = false;
    this.failed = false;
    this.happened.clear();
    const post: CohortPost = {};
    if ((counted || events) && this.used.size > 0) {
      const flags: NonNullable<CohortPost["flags"]> = {};
      for (const [key, on] of this.used) {
        flags[key] = { [on ? "on" : "off"]: { requests: 1, errors, ...(events ? { events } : {}) } };
      }
      post.flags = flags;
    }
    if (events) post.events = events;
    return post.flags || post.events ? post : null;
  }
}

export const cohorts = new FlagCohorts();

/** An OpenFeature hook: every boolean flag the app evaluates is counted, and `also` is told. */
export function cohortHook(counter: FlagCohorts = cohorts, also?: (key: string, on: boolean) => void): Hook {
  return {
    after(_ctx, details) {
      if (typeof details.value !== "boolean") return;
      counter.see(details.flagKey, details.value);
      also?.(details.flagKey, details.value);
    },
  };
}

/** Whether an API answer counts as a failure for the person: the server failed. */
export function failedResponse(status: number): boolean {
  return status >= 500;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

export interface CohortOptions {
  http: Http;
  counter?: FlagCohorts;
  every?: number;
  /** Whether the app is in the foreground now (AppState.currentState === "active"). */
  foreground: () => boolean;
  /** React Native's ErrorUtils: uncaught JavaScript errors count too. */
  errorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(handler: GlobalHandler): void };
}

/** Counts uncaught errors and foreground minutes, and posts each minute's counts. Returns a stop function. */
export function startCohorts({
  http,
  counter = cohorts,
  every = 60_000,
  foreground,
  errorUtils,
}: CohortOptions): () => void {
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      counter.fail();
      previous(error, isFatal);
    });
  }
  const timer = setInterval(() => {
    if (foreground()) counter.touch();
    const body = counter.take();
    if (!body) return;
    // Signed out or offline: the BFF can't take it, and a lost minute is fine.
    http.send({ method: "POST", path: "/flag-cohorts", body }).catch(() => undefined);
  }, every);
  return () => {
    clearInterval(timer);
  };
}
